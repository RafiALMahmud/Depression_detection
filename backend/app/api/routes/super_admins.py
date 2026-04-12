from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.system_admin import SuperAdminListResponse
from app.schemas.user import UserRead
from app.services.audit import log_audit
from app.services.pagination import paginate

PRIMARY_SUPER_ADMIN_EMAIL = "rafi.almahmud.007@gmail.com"

router = APIRouter(prefix="/super-admins", tags=["Super Admins"])


def _require_primary_super_admin(current_user: User) -> None:
    if current_user.email.strip().lower() != PRIMARY_SUPER_ADMIN_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the primary super admin can delete super admin accounts",
        )


@router.get("", response_model=SuperAdminListResponse)
def list_super_admins(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SuperAdminListResponse:
    query = select(User).where(User.role == UserRole.SUPER_ADMIN)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
    query = query.order_by(User.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    return SuperAdminListResponse(items=[UserRead.model_validate(item) for item in items], meta=meta)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_super_admin(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> None:
    _require_primary_super_admin(current_user)

    user = db.scalar(select(User).where(User.id == user_id, User.role == UserRole.SUPER_ADMIN))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Super admin not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own account")

    db.delete(user)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_super_admin",
        entity_type="user",
        entity_id=user_id,
        metadata_json={"email": user.email, "role": UserRole.SUPER_ADMIN.value},
    )
    db.commit()
