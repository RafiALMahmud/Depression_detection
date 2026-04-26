from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.consultant import Consultant
from app.models.company import Company
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.consultant import (
    ConsultantCreate,
    ConsultantDashboardSummary,
    ConsultantListResponse,
    ConsultantRead,
    ConsultantUpdate,
)
from app.schemas.user import UserRead
from app.services.audit import log_audit
from app.services.consultant_service import (
    get_advised_employee_count,
    get_consultant_profile_for_user_or_none,
    list_consultant_threads,
)
from app.services.hierarchy import (
    ensure_company_access_for_company_head,
    get_company_head_profile_for_user_or_403,
    get_company_or_404,
)
from app.services.invitations import create_and_send_invitation

router = APIRouter(prefix="/consultants", tags=["Consultants"])


def _get_consultant_or_404(db: Session, consultant_id: int) -> Consultant:
    c = db.scalar(
        select(Consultant)
        .options(selectinload(Consultant.user), selectinload(Consultant.company))
        .where(Consultant.id == consultant_id)
    )
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consultant not found")
    return c


def _serialize(c: Consultant, db: Session) -> ConsultantRead:
    from app.services.invitations import invitation_snapshot_for_user
    inv = invitation_snapshot_for_user(c.user) if c.user and c.user.invitations else None
    return ConsultantRead(
        id=c.id,
        user=UserRead.model_validate(c.user),
        company_id=c.company_id,
        company_name=c.company.name if c.company else None,
        professional_title=c.professional_title,
        specialization=c.specialization,
        bio=c.bio,
        is_active=c.is_active,
        invitation=inv,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


def _assert_company_scope(db: Session, company_id: int, current_user: User) -> None:
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN}:
        return
    if current_user.role == UserRole.COMPANY_HEAD:
        profile = get_company_head_profile_for_user_or_403(db, current_user)
        ensure_company_access_for_company_head(profile, company_id)
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


@router.get("", response_model=ConsultantListResponse)
def list_consultants(
    company_id: int | None = Query(default=None, ge=1),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD)
    ),
) -> ConsultantListResponse:
    query = (
        select(Consultant)
        .options(selectinload(Consultant.user), selectinload(Consultant.company))
    )

    if current_user.role == UserRole.COMPANY_HEAD:
        profile = get_company_head_profile_for_user_or_403(db, current_user)
        query = query.where(Consultant.company_id == profile.company_id)
    elif company_id:
        query = query.where(Consultant.company_id == company_id)

    if search:
        pattern = f"%{search.strip()}%"
        query = query.join(Consultant.user).where(
            User.full_name.ilike(pattern) | User.email.ilike(pattern)
        )

    query = query.order_by(Consultant.created_at.desc())
    items = db.scalars(query).all()
    return ConsultantListResponse(items=[_serialize(c, db) for c in items], total=len(items))


@router.post("", response_model=ConsultantRead, status_code=status.HTTP_201_CREATED)
def create_consultant(
    payload: ConsultantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD)
    ),
) -> ConsultantRead:
    _assert_company_scope(db, payload.company_id, current_user)
    company = get_company_or_404(db, payload.company_id)

    normalized_email = payload.email.strip().lower()
    existing_user = db.scalar(select(User).where(User.email == normalized_email))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already registered")

    user = User(
        full_name=payload.full_name.strip(),
        email=normalized_email,
        role=UserRole.CONSULTANT,
        is_active=False,
    )
    db.add(user)
    db.flush()

    consultant = Consultant(
        user_id=user.id,
        company_id=company.id,
        professional_title=payload.professional_title,
        specialization=payload.specialization,
        bio=payload.bio,
        is_active=True,
        created_by_user_id=current_user.id,
    )
    db.add(consultant)
    db.flush()

    invitation = create_and_send_invitation(
        db,
        user=user,
        role=UserRole.CONSULTANT,
        company_id=company.id,
        department_id=None,
        created_by_user_id=current_user.id,
    )

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="create_consultant",
        entity_type="consultant",
        entity_id=consultant.id,
        metadata_json={"email": normalized_email, "company_id": company.id},
    )
    db.commit()
    db.refresh(consultant)
    db.refresh(user)
    return _serialize(consultant, db)


@router.patch("/{consultant_id}", response_model=ConsultantRead)
def update_consultant(
    consultant_id: int,
    payload: ConsultantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD)
    ),
) -> ConsultantRead:
    c = _get_consultant_or_404(db, consultant_id)
    _assert_company_scope(db, c.company_id, current_user)

    if payload.full_name is not None:
        c.user.full_name = payload.full_name.strip()
    if payload.professional_title is not None:
        c.professional_title = payload.professional_title
    if payload.specialization is not None:
        c.specialization = payload.specialization
    if payload.bio is not None:
        c.bio = payload.bio
    if payload.is_active is not None:
        c.is_active = payload.is_active
        c.user.is_active = payload.is_active

    log_audit(
        db,
        actor_user_id=current_user.id,
        action="update_consultant",
        entity_type="consultant",
        entity_id=c.id,
        metadata_json={"company_id": c.company_id},
    )
    db.commit()
    db.refresh(c)
    return _serialize(c, db)


@router.delete("/{consultant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_consultant(
    consultant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD)
    ),
) -> None:
    c = _get_consultant_or_404(db, consultant_id)
    _assert_company_scope(db, c.company_id, current_user)
    user = c.user
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="delete_consultant",
        entity_type="consultant",
        entity_id=c.id,
        metadata_json={"email": user.email if user else None},
    )
    db.delete(user)
    db.commit()


@router.get("/me/dashboard-summary", response_model=ConsultantDashboardSummary)
def get_consultant_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> ConsultantDashboardSummary:
    consultant = get_consultant_profile_for_user_or_none(db, current_user)
    if not consultant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consultant profile not found")

    db.refresh(consultant, ["company"])
    threads = list_consultant_threads(db, current_user)
    active = sum(1 for t in threads if t.status in ("active", "assigned"))
    pending = sum(1 for t in threads if t.status == "open")
    resolved = sum(1 for t in threads if t.status in ("resolved", "closed"))
    advised = get_advised_employee_count(db, consultant.company_id)

    return ConsultantDashboardSummary(
        company_name=consultant.company.name if consultant.company else "Unknown",
        professional_title=consultant.professional_title,
        specialization=consultant.specialization,
        active_threads=active,
        pending_threads=pending,
        resolved_threads=resolved,
        advised_employees_count=advised,
    )


@router.get("/me/profile", response_model=ConsultantRead)
def get_my_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> ConsultantRead:
    consultant = get_consultant_profile_for_user_or_none(db, current_user)
    if not consultant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consultant profile not found")
    db.refresh(consultant, ["user", "company"])
    return _serialize(consultant, db)


@router.patch("/me/profile", response_model=ConsultantRead)
def update_my_profile(
    payload: ConsultantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> ConsultantRead:
    consultant = get_consultant_profile_for_user_or_none(db, current_user)
    if not consultant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consultant profile not found")

    if payload.professional_title is not None:
        consultant.professional_title = payload.professional_title
    if payload.specialization is not None:
        consultant.specialization = payload.specialization
    if payload.bio is not None:
        consultant.bio = payload.bio

    db.commit()
    db.refresh(consultant)
    return _serialize(consultant, db)
