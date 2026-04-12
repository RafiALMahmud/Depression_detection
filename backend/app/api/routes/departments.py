from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.department import Department
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.department import DepartmentCreate, DepartmentListResponse, DepartmentOption, DepartmentRead, DepartmentUpdate
from app.services.audit import log_audit
from app.services.hierarchy import get_company_or_404
from app.services.pagination import paginate

router = APIRouter(prefix="/departments", tags=["Departments"])


def _get_department_or_404(db: Session, department_id: int) -> Department:
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    return department


@router.get("", response_model=DepartmentListResponse)
def list_departments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    company_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentListResponse:
    query = select(Department)
    if company_id:
        query = query.where(Department.company_id == company_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(Department.name.ilike(pattern), Department.code.ilike(pattern)))
    query = query.order_by(Department.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    return DepartmentListResponse(items=[DepartmentRead.model_validate(item) for item in items], meta=meta)


@router.get("/options", response_model=list[DepartmentOption])
def list_department_options(
    company_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> list[DepartmentOption]:
    query = select(Department)
    if company_id:
        query = query.where(Department.company_id == company_id)
    departments = db.scalars(query.order_by(Department.name.asc())).all()
    return [DepartmentOption.model_validate(department) for department in departments]


@router.post("", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentRead:
    get_company_or_404(db, payload.company_id)
    duplicate = db.scalar(
        select(Department).where(and_(Department.company_id == payload.company_id, Department.code == payload.code))
    )
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department code already exists for company")

    department = Department(
        company_id=payload.company_id,
        name=payload.name.strip(),
        code=payload.code.strip().upper(),
        description=payload.description,
        is_active=payload.is_active,
    )
    db.add(department)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid department data") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_department",
        entity_type="department",
        entity_id=department.id,
        metadata_json={"company_id": department.company_id, "code": department.code},
    )
    db.commit()
    db.refresh(department)
    return DepartmentRead.model_validate(department)


@router.get("/{department_id}", response_model=DepartmentRead)
def get_department(
    department_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentRead:
    return DepartmentRead.model_validate(_get_department_or_404(db, department_id))


@router.put("/{department_id}", response_model=DepartmentRead)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentRead:
    department = _get_department_or_404(db, department_id)
    next_company_id = payload.company_id if payload.company_id is not None else department.company_id
    if payload.company_id is not None:
        get_company_or_404(db, payload.company_id)

    next_code = payload.code.strip().upper() if payload.code is not None else department.code
    duplicate = db.scalar(
        select(Department).where(
            and_(
                Department.company_id == next_company_id,
                Department.code == next_code,
                Department.id != department.id,
            )
        )
    )
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department code already exists for company")

    if payload.company_id is not None:
        department.company_id = payload.company_id
    if payload.name is not None:
        department.name = payload.name.strip()
    if payload.code is not None:
        department.code = next_code
    if payload.description is not None:
        department.description = payload.description
    if payload.is_active is not None:
        department.is_active = payload.is_active

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid department update") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_department",
        entity_type="department",
        entity_id=department.id,
    )
    db.commit()
    db.refresh(department)
    return DepartmentRead.model_validate(department)


@router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> None:
    department = _get_department_or_404(db, department_id)
    db.delete(department)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_department",
        entity_type="department",
        entity_id=department_id,
    )
    db.commit()
