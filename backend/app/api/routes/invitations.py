from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.core.security import get_password_hash
from app.db.session import get_db
from app.models.enums import InvitationStatus, UserRole
from app.models.invitation import Invitation
from app.models.user import User
from app.schemas.invitation import (
    InvitationActionResponse,
    InvitationListItem,
    InvitationListResponse,
    InvitationSignupRequest,
    InvitationSignupResponse,
    InvitationSnapshot,
    InvitationValidateRequest,
    InvitationValidateResponse,
)
from app.services.audit import log_audit
from app.services.hierarchy import (
    ensure_company_access_for_company_head,
    ensure_company_access_for_department_manager,
    ensure_department_access_for_department_manager,
    get_company_head_profile_for_user_or_403,
    get_department_manager_profile_for_user_or_403,
)
from app.services.invitations import (
    cancel_invitation,
    complete_signup_with_invitation,
    expire_due_invitations,
    get_company_and_department_names,
    resend_invitation,
    validate_invitation,
)
from app.services.pagination import paginate

router = APIRouter(prefix="/invitations", tags=["Invitations"])


def _get_invitation_or_404(db: Session, invitation_id: int) -> Invitation:
    invitation = db.scalar(
        select(Invitation)
        .where(Invitation.id == invitation_id)
        .options(selectinload(Invitation.user), selectinload(Invitation.company), selectinload(Invitation.department))
    )
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    return invitation


def _serialize_invitation(invitation: Invitation) -> InvitationListItem:
    return InvitationListItem(
        id=invitation.id,
        full_name=invitation.user.full_name if invitation.user else invitation.email,
        email=invitation.email,
        role=invitation.role,
        company_id=invitation.company_id,
        company_name=invitation.company.name if invitation.company else None,
        department_id=invitation.department_id,
        department_name=invitation.department.name if invitation.department else None,
        status=invitation.status,
        sent_at=invitation.sent_at,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        updated_at=invitation.updated_at,
    )


def _assert_invitation_scope(db: Session, invitation: Invitation, current_user: User) -> None:
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN}:
        return

    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        if invitation.role not in {UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this invitation role")
        if invitation.company_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invitation is outside your company scope")
        ensure_company_access_for_company_head(company_head_profile, invitation.company_id)
        return

    if current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        if invitation.role != UserRole.EMPLOYEE:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this invitation role")
        if invitation.company_id is None or invitation.department_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invitation is outside your department scope")
        ensure_company_access_for_department_manager(department_manager_profile, invitation.company_id)
        ensure_department_access_for_department_manager(department_manager_profile, invitation.department_id)
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


@router.get("", response_model=InvitationListResponse, status_code=status.HTTP_200_OK)
def list_invitations(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(default=None),
    role: UserRole | None = Query(default=None),
    status_filter: InvitationStatus | None = Query(default=None, alias="status"),
    company_id: int | None = Query(default=None, ge=1),
    department_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> InvitationListResponse:
    expire_due_invitations(db)
    query = select(Invitation).options(
        selectinload(Invitation.user),
        selectinload(Invitation.company),
        selectinload(Invitation.department),
    )

    if current_user.role == UserRole.COMPANY_HEAD:
        company_head_profile = get_company_head_profile_for_user_or_403(db, current_user)
        company_id = company_head_profile.company_id
        query = query.where(Invitation.role.in_([UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE]))
        if role and role not in {UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role filter for company scope")
    elif current_user.role == UserRole.DEPARTMENT_MANAGER:
        department_manager_profile = get_department_manager_profile_for_user_or_403(db, current_user)
        company_id = department_manager_profile.company_id
        department_id = department_manager_profile.department_id
        query = query.where(Invitation.role == UserRole.EMPLOYEE)
        if role and role != UserRole.EMPLOYEE:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role filter for department scope")

    if role:
        query = query.where(Invitation.role == role)
    if status_filter:
        query = query.where(Invitation.status == status_filter)
    if company_id:
        query = query.where(Invitation.company_id == company_id)
    if department_id:
        query = query.where(Invitation.department_id == department_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.join(Invitation.user).where(or_(Invitation.email.ilike(pattern), User.full_name.ilike(pattern)))

    query = query.order_by(Invitation.created_at.desc())
    items, meta = paginate(db, query, page, page_size)
    db.commit()
    return InvitationListResponse(items=[_serialize_invitation(item) for item in items], meta=meta)


@router.post("/validate", response_model=InvitationValidateResponse, status_code=status.HTTP_200_OK)
def validate_invitation_code(payload: InvitationValidateRequest, db: Session = Depends(get_db)) -> InvitationValidateResponse:
    try:
        invitation = validate_invitation(db, email=payload.email, invitation_code=payload.invitation_code)
    except HTTPException as exc:
        db.commit()
        return InvitationValidateResponse(valid=False, message=exc.detail)

    company_name, department_name = get_company_and_department_names(db, invitation)
    response = InvitationValidateResponse(
        valid=True,
        message="Invitation is valid",
        role=invitation.role,
        company_name=company_name,
        department_name=department_name,
        full_name=invitation.user.full_name if invitation.user else None,
        email=invitation.email,
        expires_at=invitation.expires_at,
        status=invitation.status,
    )
    db.commit()
    return response


@router.post("/signup", response_model=InvitationSignupResponse, status_code=status.HTTP_200_OK)
def signup_with_invitation(payload: InvitationSignupRequest, db: Session = Depends(get_db)) -> InvitationSignupResponse:
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password and confirm password do not match")

    try:
        user, invitation = complete_signup_with_invitation(
            db,
            email=payload.email,
            invitation_code=payload.invitation_code,
            full_name=payload.full_name,
            password_hash=get_password_hash(payload.password),
        )
    except HTTPException:
        db.commit()
        raise
    log_audit(
        db,
        actor_user_id=user.id,
        action="complete_invitation_signup",
        entity_type="invitation",
        entity_id=invitation.id,
        metadata_json={"role": invitation.role.value},
    )
    db.commit()
    return InvitationSignupResponse(message="Signup completed successfully. You can now sign in.", role=user.role)


@router.post(
    "/{invitation_id}/resend",
    response_model=InvitationActionResponse,
    status_code=status.HTTP_200_OK,
)
def resend_user_invitation(
    invitation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> InvitationActionResponse:
    expire_due_invitations(db)
    invitation = _get_invitation_or_404(db, invitation_id)
    _assert_invitation_scope(db, invitation, current_user)
    if invitation.role not in {UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation resend is not supported for this role")
    new_invitation = resend_invitation(db, invitation=invitation, actor_user_id=current_user.id)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="resend_invitation",
        entity_type="invitation",
        entity_id=new_invitation.id,
        metadata_json={"user_id": new_invitation.user_id, "role": new_invitation.role.value},
    )
    db.commit()
    db.refresh(new_invitation)
    return InvitationActionResponse(
        message="Invitation resent successfully",
        invitation=InvitationSnapshot.model_validate(new_invitation),
    )


@router.post(
    "/{invitation_id}/cancel",
    response_model=InvitationActionResponse,
    status_code=status.HTTP_200_OK,
)
def cancel_user_invitation(
    invitation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER)
    ),
) -> InvitationActionResponse:
    expire_due_invitations(db)
    invitation = _get_invitation_or_404(db, invitation_id)
    _assert_invitation_scope(db, invitation, current_user)
    if invitation.role not in {UserRole.COMPANY_HEAD, UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation cancel is not supported for this role")
    cancelled = cancel_invitation(db, invitation=invitation)
    log_audit(
        db,
        actor_user_id=current_user.id,
        action="cancel_invitation",
        entity_type="invitation",
        entity_id=cancelled.id,
        metadata_json={"user_id": cancelled.user_id, "role": cancelled.role.value},
    )
    db.commit()
    db.refresh(cancelled)
    return InvitationActionResponse(
        message="Invitation cancelled successfully",
        invitation=InvitationSnapshot.model_validate(cancelled),
    )


@router.post("/expire-pending", status_code=status.HTTP_200_OK)
def expire_pending_invitations(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> dict[str, str]:
    expire_due_invitations(db)
    db.commit()
    return {"message": "Pending invitation statuses updated"}
