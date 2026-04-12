from pydantic import BaseModel, Field

from app.schemas.common import ApiMessage, EmailValidatedModel
from app.schemas.user import UserRead


class LoginRequest(EmailValidatedModel):
    email: str
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class LogoutResponse(ApiMessage):
    pass


class UpdateMeRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    password: str | None = Field(default=None, min_length=8, max_length=128)
