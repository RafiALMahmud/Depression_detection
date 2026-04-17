import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.employee import EmployeeCreate, EmployeeListResponse, EmployeeRead, EmployeeUpdate
from app.schemas.user import UserRead
from app.services.audit import log_audit
from app.services.hierarchy import (
    ensure_company_access_for_company_head,
    ensure_company_access_for_department_manager,
    ensure_department_access_for_department_manager,
    get_company_head_profile_for_user_or_403,
    get_company_or_404,
    get_department_manager_profile_for_user_or_403,
    get_department_or_404,
    validate_department_belongs_to_company,
)
from app.services.invitations import (
    create_and_send_invitation,
    expire_due_invitations,
    invitation_snapshot_for_user,
    sync_pending_invitation_email,
)
from app.services.pagination import paginate
from app.services.questionnaire.session_service import get_department_compliance, update_compliance_status
from app.services.user_management import create_user, update_user

router = APIRouter(prefix="/employees", tags=["Employees"])


def _serialize_employee(employee: Employee) -> EmployeeRead:
    return EmployeeRead(
        id=employee.id,
        user=UserRead.model_validate(employee.user),
        company_id=employee.company_id,
        department_id=employee.department_id,
        employee_code=employee.employee_code,
        job_title=employee.job_title,
        invitation=invitation_snapshot_for_user(employee.user),
        created_at=employee.created_at,
        updated_at=employee.updated_at,
    )


def _get_employee_or_404(db: Session, employee_id: int) -> Employee:
    employee = db.scalar(
        select(Employee).where(Employee.id == employee_id).options(selectinload(Employee.user).selectinload(User.invitations))
    )
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


def _generate_employee_code(db: Session) -> str:
    for _ in range(20):
        generated_code = f"EMP{secrets.randbelow(1_000_000):06d}"
        exists = db.scalar(select(Employee.id).where(Employee.employee_code == generated_code))
        if not exists:
            return generated_code
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate employee code")


@router.get("", response_model=EmployeeListResponse)
def list_employees(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    company_id: int | None = Query(default=None, ge=1),
    department_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> EmployeeListResponse:
    expire_due_invitations(db)
    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        company_id = company_head_profile.company_id
    elif current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        company_id = department_manager_profile.company_id
        department_id = department_manager_profile.department_id

    query = select(Employee).join(Employee.user).options(selectinload(Employee.user).selectinload(User.invitations))
    if company_id:
        query = query.where(Employee.company_id == company_id)
    if department_id:
        query = query.where(Employee.department_id == department_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(
            or_(User.full_name.ilike(pattern), User.email.ilike(pattern), Employee.employee_code.ilike(pattern))
        )
    query = query.order_by(Employee.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    db.commit()
    return EmployeeListResponse(items=[_serialize_employee(item) for item in items], meta=meta)


@router.post("", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> EmployeeRead:
    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_company_head(company_head_profile, payload.company_id)
    elif current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_department_manager(department_manager_profile, payload.company_id)
        ensure_department_access_for_department_manager(department_manager_profile, payload.department_id)

    company = get_company_or_404(db, payload.company_id)
    department = get_department_or_404(db, payload.department_id)
    validate_department_belongs_to_company(department, payload.company_id)
    employee_code = payload.employee_code or _generate_employee_code(db)

    user = create_user(
        db,
        full_name=payload.full_name,
        email=payload.email,
        password=None,
        role=UserRole.EMPLOYEE,
        is_active=False,
        invited_by_user_id=current_user.id,
    )
    employee = Employee(
        user_id=user.id,
        company_id=payload.company_id,
        department_id=payload.department_id,
        employee_code=employee_code,
        job_title=payload.job_title,
    )
    db.add(employee)
    try:
        db.flush()
        invitation = create_and_send_invitation(
            db,
            user=user,
            role=UserRole.EMPLOYEE,
            company_id=payload.company_id,
            department_id=payload.department_id,
            created_by_user_id=current_user.id,
        )
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid employee data") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_employee_invited",
        entity_type="employee",
        entity_id=employee.id,
        metadata_json={
            "company_id": payload.company_id,
            "company_name": company.name,
            "department_id": payload.department_id,
            "department_name": department.name,
            "invitation_id": invitation.id,
        },
    )
    db.commit()
    db.refresh(employee)
    db.refresh(user)
    return _serialize_employee(employee)


@router.get("/compliance", response_model=list[dict])
def get_compliance(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> list[dict]:
    """Return compliance status for all employees in the manager's department."""
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    employees = db.query(Employee).filter(Employee.department_id == manager.department_id).all()
    for emp in employees:
        update_compliance_status(db, emp.id)
    db.commit()
    return get_department_compliance(db, manager.department_id)


@router.get("/{employee_id}", response_model=EmployeeRead)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> EmployeeRead:
    expire_due_invitations(db)
    employee = _get_employee_or_404(db, employee_id)
    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_company_head(company_head_profile, employee.company_id)
    elif current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_department_manager(department_manager_profile, employee.company_id)
        ensure_department_access_for_department_manager(department_manager_profile, employee.department_id)

    db.commit()
    return _serialize_employee(employee)


@router.put("/{employee_id}", response_model=EmployeeRead)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> EmployeeRead:
    employee = _get_employee_or_404(db, employee_id)
    company_head_profile = None
    department_manager_profile = None
    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_company_head(company_head_profile, employee.company_id)
    elif current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_department_manager(department_manager_profile, employee.company_id)
        ensure_department_access_for_department_manager(department_manager_profile, employee.department_id)

    update_user(
        db,
        user=employee.user,
        full_name=payload.full_name,
        email=payload.email,
        is_active=payload.is_active,
    )
    sync_pending_invitation_email(employee.user)

    next_company_id = payload.company_id if payload.company_id is not None else employee.company_id
    if company_head_profile:
        next_company_id = company_head_profile.company_id
    if department_manager_profile:
        next_company_id = department_manager_profile.company_id

    if payload.company_id is not None:
        if company_head_profile:
            ensure_company_access_for_company_head(company_head_profile, payload.company_id)
        if department_manager_profile:
            ensure_company_access_for_department_manager(department_manager_profile, payload.company_id)
        get_company_or_404(db, payload.company_id)

    next_department_id = payload.department_id if payload.department_id is not None else employee.department_id
    if department_manager_profile:
        next_department_id = department_manager_profile.department_id

    department = get_department_or_404(db, next_department_id)
    validate_department_belongs_to_company(department, next_company_id)
    if department_manager_profile:
        ensure_department_access_for_department_manager(department_manager_profile, next_department_id)

    if payload.job_title is not None:
        employee.job_title = payload.job_title
    if payload.employee_code is not None:
        employee.employee_code = payload.employee_code

    employee.company_id = next_company_id
    employee.department_id = next_department_id

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid employee update") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_employee",
        entity_type="employee",
        entity_id=employee.id,
    )
    db.commit()
    db.refresh(employee)
    db.refresh(employee.user)
    return _serialize_employee(employee)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> None:
    employee = _get_employee_or_404(db, employee_id)
    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_company_head(company_head_profile, employee.company_id)
    elif current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_department_manager(department_manager_profile, employee.company_id)
        ensure_department_access_for_department_manager(department_manager_profile, employee.department_id)

    user = employee.user
    db.delete(employee)
    if user:
        db.delete(user)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_employee",
        entity_type="employee",
        entity_id=employee_id,
    )
    db.commit()


