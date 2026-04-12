from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.core.security import get_password_hash
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.invitation import Invitation
from app.models.user import User
from app.schemas.invitation import (
    InvitationActionResponse,
    InvitationSignupRequest,
    InvitationSignupResponse,
    InvitationSnapshot,
    InvitationValidateRequest,
    InvitationValidateResponse,
)
from app.services.audit import log_audit
from app.services.invitations import (
    cancel_invitation,
    complete_signup_with_invitation,
    expire_due_invitations,
    get_company_and_department_names,
    resend_invitation,
    validate_invitation,
)

router = APIRouter(prefix="/invitations", tags=["Invitations"])


def _get_invitation_or_404(db: Session, invitation_id: int) -> Invitation:
    invitation = db.scalar(
        select(Invitation).where(Invitation.id == invitation_id).options(selectinload(Invitation.user))
    )
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    return invitation


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
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> InvitationActionResponse:
    invitation = _get_invitation_or_404(db, invitation_id)
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
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> InvitationActionResponse:
    invitation = _get_invitation_or_404(db, invitation_id)
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
