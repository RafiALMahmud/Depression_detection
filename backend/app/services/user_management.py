from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.user import User


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def assert_email_available(db: Session, email: str, exclude_user_id: int | None = None) -> None:
    email_lower = email.strip().lower()
    existing = get_user_by_email(db, email_lower)
    if existing and existing.id != exclude_user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")


def create_user(
    db: Session,
    *,
    full_name: str,
    email: str,
    password: str | None,
    role: UserRole,
    is_active: bool = True,
    invited_by_user_id: int | None = None,
) -> User:
    normalized_email = email.strip().lower()
    assert_email_available(db, normalized_email)
    user = User(
        full_name=full_name.strip(),
        email=normalized_email,
        password_hash=get_password_hash(password) if password else None,
        role=role,
        is_active=is_active,
        invited_by_user_id=invited_by_user_id,
    )
    db.add(user)
    db.flush()
    return user


def update_user(
    db: Session,
    *,
    user: User,
    full_name: str | None = None,
    email: str | None = None,
    password: str | None = None,
    is_active: bool | None = None,
) -> User:
    if full_name is not None:
        user.full_name = full_name.strip()
    if email is not None:
        normalized_email = email.strip().lower()
        assert_email_available(db, normalized_email, exclude_user_id=user.id)
        user.email = normalized_email
    if password:
        user.password_hash = get_password_hash(password)
    if is_active is not None:
        user.is_active = is_active
    db.flush()
    return user
