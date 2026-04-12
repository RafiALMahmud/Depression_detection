from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, LogoutResponse, TokenResponse, UpdateMeRequest
from app.schemas.user import UserRead
from app.services.user_management import update_user

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse, status_code=status.HTTP_200_OK)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email.strip().lower()))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account setup is pending. Complete signup using your invitation code.",
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is deactivated")

    access_token = create_access_token(subject=str(user.id), role=user.role.value)
    return TokenResponse(access_token=access_token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead, status_code=status.HTTP_200_OK)
def current_user(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)


@router.post("/logout", response_model=LogoutResponse, status_code=status.HTTP_200_OK)
def logout(current_user: User = Depends(get_current_user)) -> LogoutResponse:
    return LogoutResponse(message=f"Logged out {current_user.email}")


@router.patch("/me", response_model=UserRead, status_code=status.HTTP_200_OK)
def update_me(
    payload: UpdateMeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    update_user(
        db,
        user=current_user,
        full_name=payload.full_name,
        password=payload.password,
    )
    db.commit()
    db.refresh(current_user)
    return UserRead.model_validate(current_user)
