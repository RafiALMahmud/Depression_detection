from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.system_admin_profile import SystemAdminProfile
from app.models.user import User
from app.schemas.system_admin import (
    SystemAdminCreate,
    SystemAdminListResponse,
    SystemAdminRead,
    SystemAdminUpdate,
)
from app.services.audit import log_audit
from app.services.pagination import paginate
from app.services.user_management import create_user, update_user

router = APIRouter(prefix="/system-admins", tags=["System Admins"])


def _get_profile_or_404(db: Session, profile_id: int) -> SystemAdminProfile:
    profile = db.scalar(
        select(SystemAdminProfile)
        .where(SystemAdminProfile.id == profile_id)
        .options(selectinload(SystemAdminProfile.user))
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System admin not found")
    return profile


@router.get("", response_model=SystemAdminListResponse)
def list_system_admins(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SystemAdminListResponse:
    query = select(SystemAdminProfile).join(SystemAdminProfile.user).options(selectinload(SystemAdminProfile.user))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
    query = query.order_by(SystemAdminProfile.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    return SystemAdminListResponse(items=[SystemAdminRead.model_validate(item) for item in items], meta=meta)


@router.post("", response_model=SystemAdminRead, status_code=status.HTTP_201_CREATED)
def create_system_admin(
    payload: SystemAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SystemAdminRead:
    user = create_user(
        db,
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        role=UserRole.SYSTEM_ADMIN,
        is_active=payload.is_active,
    )
    profile = SystemAdminProfile(user_id=user.id, created_by_user_id=current_user.id)
    db.add(profile)
    db.flush()
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_system_admin",
        entity_type="system_admin_profile",
        entity_id=profile.id,
        metadata_json={"email": user.email},
    )
    db.commit()
    db.refresh(profile)
    return SystemAdminRead.model_validate(profile)


@router.get("/{profile_id}", response_model=SystemAdminRead)
def get_system_admin(
    profile_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SystemAdminRead:
    profile = _get_profile_or_404(db, profile_id)
    return SystemAdminRead.model_validate(profile)


@router.put("/{profile_id}", response_model=SystemAdminRead)
def update_system_admin(
    profile_id: int,
    payload: SystemAdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SystemAdminRead:
    profile = _get_profile_or_404(db, profile_id)
    update_user(
        db,
        user=profile.user,
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        is_active=payload.is_active,
    )
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_system_admin",
        entity_type="system_admin_profile",
        entity_id=profile.id,
    )
    db.commit()
    db.refresh(profile)
    return SystemAdminRead.model_validate(profile)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_system_admin(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> None:
    profile = _get_profile_or_404(db, profile_id)
    if profile.user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")

    user = profile.user
    db.delete(profile)
    if user:
        db.delete(user)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_system_admin",
        entity_type="system_admin_profile",
        entity_id=profile_id,
    )
    db.commit()

