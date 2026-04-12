from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.company_head import CompanyHead
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.company_head import CompanyHeadCreate, CompanyHeadListResponse, CompanyHeadRead, CompanyHeadUpdate
from app.schemas.user import UserRead
from app.services.audit import log_audit
from app.services.hierarchy import get_company_or_404
from app.services.invitations import (
    create_and_send_invitation,
    expire_due_invitations,
    invitation_snapshot_for_user,
    sync_pending_invitation_email,
)
from app.services.pagination import paginate
from app.services.user_management import create_user, update_user

router = APIRouter(prefix="/company-heads", tags=["Company Heads"])


def _serialize_company_head(profile: CompanyHead) -> CompanyHeadRead:
    return CompanyHeadRead(
        id=profile.id,
        user=UserRead.model_validate(profile.user),
        company_id=profile.company_id,
        invitation=invitation_snapshot_for_user(profile.user),
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _get_company_head_or_404(db: Session, profile_id: int) -> CompanyHead:
    profile = db.scalar(
        select(CompanyHead)
        .where(CompanyHead.id == profile_id)
        .options(selectinload(CompanyHead.user).selectinload(User.invitations))
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company head not found")
    return profile


@router.get("", response_model=CompanyHeadListResponse)
def list_company_heads(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    company_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyHeadListResponse:
    expire_due_invitations(db)
    query = (
        select(CompanyHead)
        .join(CompanyHead.user)
        .options(selectinload(CompanyHead.user).selectinload(User.invitations))
    )
    if company_id:
        query = query.where(CompanyHead.company_id == company_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(User.full_name.ilike(pattern), User.email.ilike(pattern)))
    query = query.order_by(CompanyHead.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    db.commit()
    return CompanyHeadListResponse(items=[_serialize_company_head(item) for item in items], meta=meta)


@router.post("", response_model=CompanyHeadRead, status_code=status.HTTP_201_CREATED)
def create_company_head(
    payload: CompanyHeadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyHeadRead:
    company = get_company_or_404(db, payload.company_id)
    existing_for_company = db.scalar(select(CompanyHead).where(CompanyHead.company_id == payload.company_id))
    if existing_for_company:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company already has a company head")

    user = create_user(
        db,
        full_name=payload.full_name,
        email=payload.email,
        password=None,
        role=UserRole.COMPANY_HEAD,
        is_active=False,
        invited_by_user_id=current_user.id,
    )
    profile = CompanyHead(user_id=user.id, company_id=payload.company_id)
    db.add(profile)
    try:
        db.flush()
        invitation = create_and_send_invitation(
            db,
            user=user,
            role=UserRole.COMPANY_HEAD,
            company_id=payload.company_id,
            department_id=None,
            created_by_user_id=current_user.id,
        )
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company head already exists") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_company_head_invited",
        entity_type="company_head",
        entity_id=profile.id,
        metadata_json={
            "company_id": payload.company_id,
            "company_name": company.name,
            "invitation_id": invitation.id,
        },
    )
    db.commit()
    db.refresh(profile)
    db.refresh(user)
    return _serialize_company_head(profile)


@router.get("/{profile_id}", response_model=CompanyHeadRead)
def get_company_head(
    profile_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyHeadRead:
    expire_due_invitations(db)
    profile = _get_company_head_or_404(db, profile_id)
    db.commit()
    return _serialize_company_head(profile)


@router.put("/{profile_id}", response_model=CompanyHeadRead)
def update_company_head(
    profile_id: int,
    payload: CompanyHeadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> CompanyHeadRead:
    profile = _get_company_head_or_404(db, profile_id)
    update_user(
        db,
        user=profile.user,
        full_name=payload.full_name,
        email=payload.email,
        password=payload.password,
        is_active=payload.is_active,
    )
    sync_pending_invitation_email(profile.user)

    if payload.company_id is not None and payload.company_id != profile.company_id:
        get_company_or_404(db, payload.company_id)
        existing_for_company = db.scalar(select(CompanyHead).where(CompanyHead.company_id == payload.company_id))
        if existing_for_company and existing_for_company.id != profile.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company already has a company head")
        profile.company_id = payload.company_id

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid company head update") from exc

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_company_head",
        entity_type="company_head",
        entity_id=profile.id,
    )
    db.commit()
    db.refresh(profile)
    db.refresh(profile.user)
    return _serialize_company_head(profile)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company_head(
    profile_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> None:
    profile = _get_company_head_or_404(db, profile_id)
    user = profile.user
    db.delete(profile)
    if user:
        db.delete(user)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_company_head",
        entity_type="company_head",
        entity_id=profile_id,
    )
    db.commit()
