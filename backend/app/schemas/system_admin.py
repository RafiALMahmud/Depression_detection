from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import EMAIL_PATTERN, ORMBase, PaginationMeta
from app.schemas.user import UserRead


class SystemAdminCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: str
    password: str = Field(min_length=8, max_length=128)
    is_active: bool = True

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email


class SystemAdminUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    email: str | None = None
    is_active: bool | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is None:
            return value
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email


class SystemAdminRead(ORMBase):
    id: int
    user: UserRead
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime


class SystemAdminListResponse(BaseModel):
    items: list[SystemAdminRead]
    meta: PaginationMeta


class SuperAdminListResponse(BaseModel):
    items: list[UserRead]
    meta: PaginationMeta
