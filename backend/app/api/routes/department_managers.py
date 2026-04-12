from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.department_manager import DepartmentManager
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.department_manager import (
    DepartmentManagerCreate,
    DepartmentManagerListResponse,
    DepartmentManagerRead,
    DepartmentManagerUpdate,
)
from app.schemas.user import UserRead
from app.services.audit import log_audit
from app.services.hierarchy import get_company_or_404, get_department_or_404, validate_department_belongs_to_company
from app.services.invitations import (
    create_and_send_invitation,
    expire_due_invitations,
    invitation_snapshot_for_user,
    sync_pending_invitation_email,
)
from app.services.pagination import paginate
from app.services.user_management import create_user, update_user

router = APIRouter(prefix="/department-managers", tags=["Department Managers"])


def _serialize_department_manager(profile: DepartmentManager) -> DepartmentManagerRead:
    return DepartmentManagerRead(
        id=profile.id,
        user=UserRead.model_validate(profile.user),
        company_id=profile.company_id,
        department_id=profile.department_id,
        invitation=invitation_snapshot_for_user(profile.user),
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _get_manager_or_404(db: Session, profile_id: int) -> DepartmentManager:
    profile = db.scalar(
        select(DepartmentManager)
        .where(DepartmentManager.id == profile_id)
        .options(selectinload(DepartmentManager.user).selectinload(User.invitations))
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department manager not found")
    return profile


@router.get("", response_model=DepartmentManagerListResponse)
def list_department_managers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    company_id: int | None = Query(default=None, ge=1),
    department_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentManagerListResponse:
    expire_due_invitations(db)
    query = (
        select(DepartmentManager)
        .join(DepartmentManager.user)
        .options(selectinload(DepartmentManager.user).selectinload(User.invitations))
    )
    if company_id:
        query = query.where(DepartmentManager.company_id == company_id)
    if department_id:
        query = query.where(DepartmentManager.department_id == department_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
    query = query.order_by(DepartmentManager.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    db.commit()
    return DepartmentManagerListResponse(items=[_serialize_department_manager(item) for item in items], meta=meta)


@router.post("", response_model=DepartmentManagerRead, status_code=status.HTTP_201_CREATED)
def create_department_manager(
    payload: DepartmentManagerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentManagerRead:
    company = get_company_or_404(db, payload.company_id)
    department = get_department_or_404(db, payload.department_id)
    validate_department_belongs_to_company(department, payload.company_id)
    existing_for_department = db.scalar(select(DepartmentManager).where(DepartmentManager.department_id == payload.department_id))
    if existing_for_department:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department already has a manager")

    user = create_user(
        db,
        full_name=payload.full_name,
        email=payload.email,
        password=None,
        role=UserRole.DEPARTMENT_MANAGER,
        is_active=False,
        invited_by_user_id=current_user.id,
    )
    profile = DepartmentManager(
        user_id=user.id,
        company_id=payload.company_id,
        department_id=payload.department_id,
    )
    db.add(profile)
    try:
        db.flush()
        invitation = create_and_send_invitation(
            db,
            user=user,
            role=UserRole.DEPARTMENT_MANAGER,
            company_id=payload.company_id,
            department_id=payload.department_id,
            created_by_user_id=current_user.id,
        )
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department manager already exists") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_department_manager_invited",
        entity_type="department_manager",
        entity_id=profile.id,
        metadata_json={
            "company_id": payload.company_id,
            "company_name": company.name,
            "department_id": payload.department_id,
            "department_name": department.name,
            "invitation_id": invitation.id,
        },
    )
    db.commit()
    db.refresh(profile)
    db.refresh(user)
    return _serialize_department_manager(profile)


@router.get("/{profile_id}", response_model=DepartmentManagerRead)
def get_department_manager(
    profile_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentManagerRead:
    expire_due_invitations(db)
    profile = _get_manager_or_404(db, profile_id)
    db.commit()
    return _serialize_department_manager(profile)


@router.put("/{profile_id}", response_model=DepartmentManagerRead)
def update_department_manager(
    profile_id: int,
    payload: DepartmentManagerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> DepartmentManagerRead:
    profile = _get_manager_or_404(db, profile_id)
    update_user(
        db,
        user=profile.user,
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        is_active=payload.is_active,
    )
    sync_pending_invitation_email(profile.user)

    next_company_id = payload.company_id if payload.company_id is not None else profile.company_id
    if payload.company_id is not None:
        get_company_or_404(db, payload.company_id)

    next_department_id = payload.department_id if payload.department_id is not None else profile.department_id
    department = get_department_or_404(db, next_department_id)
    validate_department_belongs_to_company(department, next_company_id)

    conflict = db.scalar(
        select(DepartmentManager).where(
            and_(DepartmentManager.department_id == next_department_id, DepartmentManager.id != profile.id)
        )
    )
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department already has a manager")

    profile.company_id = next_company_id
    profile.department_id = next_department_id

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid department manager update") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_department_manager",
        entity_type="department_manager",
        entity_id=profile.id,
    )
    db.commit()
    db.refresh(profile)
    db.refresh(profile.user)
    return _serialize_department_manager(profile)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department_manager(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> None:
    profile = _get_manager_or_404(db, profile_id)
    user = profile.user
    db.delete(profile)
    if user:
        db.delete(user)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_department_manager",
        entity_type="department_manager",
        entity_id=profile_id,
    )
    db.commit()
