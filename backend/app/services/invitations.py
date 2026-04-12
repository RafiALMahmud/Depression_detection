import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.company import Company
from app.models.department import Department
from app.models.enums import InvitationStatus, UserRole
from app.models.invitation import Invitation
from app.models.user import User
from app.schemas.invitation import InvitationSnapshot
from app.services.email import build_invitation_email_html, role_label, send_email


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _hash_code(invitation_code: str) -> str:
    digest = hmac.new(
        settings.invitation_code_secret.encode("utf-8"),
        invitation_code.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest


def _generate_code() -> str:
    return str(secrets.randbelow(900_000_000) + 100_000_000)


def generate_unique_code(db: Session) -> tuple[str, str]:
    for _ in range(15):
        code = _generate_code()
        code_hash = _hash_code(code)
        exists = db.scalar(
            select(Invitation).where(
                and_(Invitation.invitation_code_hash == code_hash, Invitation.status == InvitationStatus.PENDING)
            )
        )
        if not exists:
            return code, code_hash
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate invitation code")


def expire_due_invitations(db: Session) -> None:
    current_time = now_utc()
    pending_invitations = db.scalars(select(Invitation).where(Invitation.status == InvitationStatus.PENDING)).all()
    for invitation in pending_invitations:
        if invitation.expires_at and invitation.expires_at <= current_time:
            invitation.status = InvitationStatus.EXPIRED
    db.flush()


def _latest_invitation_for_user(user: User) -> Invitation | None:
    if not user.invitations:
        return None
    return max(user.invitations, key=lambda item: item.created_at)


def invitation_snapshot_for_user(user: User) -> InvitationSnapshot | None:
    latest = _latest_invitation_for_user(user)
    if not latest:
        return None
    return InvitationSnapshot.model_validate(latest)


def sync_pending_invitation_email(user: User) -> None:
    for invitation in user.invitations:
        if invitation.status == InvitationStatus.PENDING:
            invitation.email = user.email


def _build_signup_url(email: str) -> str:
    safe_email = email.strip().lower()
    return f"{settings.frontend_base_url.rstrip('/')}/signup?email={safe_email}"


def create_and_send_invitation(
    db: Session,
    *,
    user: User,
    role: UserRole,
    company_id: int | None,
    department_id: int | None,
    created_by_user_id: int,
) -> Invitation:
    expire_due_invitations(db)
    current_time = now_utc()

    existing_pending = db.scalars(
        select(Invitation).where(and_(Invitation.user_id == user.id, Invitation.status == InvitationStatus.PENDING))
    ).all()
    for pending_invitation in existing_pending:
        pending_invitation.status = InvitationStatus.CANCELLED

    invitation_code, invitation_code_hash = generate_unique_code(db)
    expires_at = current_time + timedelta(days=settings.invitation_expire_days)
    invitation = Invitation(
        user_id=user.id,
        email=user.email,
        role=role,
        company_id=company_id,
        department_id=department_id,
        invitation_code_hash=invitation_code_hash,
        status=InvitationStatus.PENDING,
        expires_at=expires_at,
        created_by_user_id=created_by_user_id,
    )
    db.add(invitation)
    db.flush()

    company_name = "MindWell"
    if company_id:
        company = db.get(Company, company_id)
        if company:
            company_name = company.name

    signup_url = _build_signup_url(user.email)
    subject = f"MindWell Invitation - {role_label(role)} at {company_name}"
    html_body = build_invitation_email_html(
        full_name=user.full_name,
        company_name=company_name,
        role=role,
        signup_url=signup_url,
        invitation_code=invitation_code,
    )
    text_body = (
        f"Hello {user.full_name},\n\n"
        f"You have been invited to join {company_name} as {role_label(role)}.\n"
        f"Complete signup here: {signup_url}\n"
        f"Invitation code: {invitation_code}\n\n"
        "This 9-digit code is required to complete signup."
    )

    try:
        send_email(to_email=user.email, subject=subject, html_body=html_body, text_body=text_body)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Invitation email failed to send: {exc}",
        ) from exc

    invitation.sent_at = now_utc()
    return invitation


def validate_invitation(
    db: Session,
    *,
    email: str,
    invitation_code: str,
) -> Invitation:
    expire_due_invitations(db)
    normalized_email = email.strip().lower()
    code_hash = _hash_code(invitation_code)

    invitation = db.scalar(
        select(Invitation)
        .where(
            and_(
                Invitation.email == normalized_email,
                Invitation.invitation_code_hash == code_hash,
            )
        )
        .order_by(Invitation.created_at.desc())
    )
    if not invitation:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invitation email or code")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invitation is {invitation.status.value}")

    if invitation.expires_at and invitation.expires_at <= now_utc():
        invitation.status = InvitationStatus.EXPIRED
        db.flush()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation has expired")

    return invitation


def resend_invitation(db: Session, *, invitation: Invitation, actor_user_id: int) -> Invitation:
    expire_due_invitations(db)
    if invitation.status == InvitationStatus.USED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation already used")

    user = invitation.user
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation user not found")
    if user.password_hash and user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User account is already active")

    invitation.status = InvitationStatus.CANCELLED
    db.flush()
    return create_and_send_invitation(
        db,
        user=user,
        role=invitation.role,
        company_id=invitation.company_id,
        department_id=invitation.department_id,
        created_by_user_id=actor_user_id,
    )


def cancel_invitation(db: Session, *, invitation: Invitation) -> Invitation:
    expire_due_invitations(db)
    if invitation.status == InvitationStatus.USED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Used invitation cannot be cancelled")
    invitation.status = InvitationStatus.CANCELLED
    db.flush()
    return invitation


def complete_signup_with_invitation(
    db: Session,
    *,
    email: str,
    invitation_code: str,
    full_name: str,
    password_hash: str,
) -> tuple[User, Invitation]:
    invitation = validate_invitation(db, email=email, invitation_code=invitation_code)
    user = invitation.user
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation user not found")

    user.full_name = full_name.strip()
    user.password_hash = password_hash
    user.is_active = True

    invitation.status = InvitationStatus.USED
    invitation.used_at = now_utc()
    db.flush()
    return user, invitation


def get_company_and_department_names(db: Session, invitation: Invitation) -> tuple[str | None, str | None]:
    company_name = None
    department_name = None
    if invitation.company_id:
        company = db.get(Company, invitation.company_id)
        if company:
            company_name = company.name
    if invitation.department_id:
        department = db.get(Department, invitation.department_id)
        if department:
            department_name = department.name
    return company_name, department_name
