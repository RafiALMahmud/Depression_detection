from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import EMAIL_PATTERN, ORMBase, PaginationMeta
from app.schemas.invitation import InvitationSnapshot
from app.schemas.user import UserRead


class CompanyHeadCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: str
    company_id: int = Field(ge=1)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email


class CompanyHeadUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    email: str | None = None
    company_id: int | None = Field(default=None, ge=1)
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


class CompanyHeadRead(ORMBase):
    id: int
    user: UserRead
    company_id: int
    invitation: InvitationSnapshot | None = None
    created_at: datetime
    updated_at: datetime


class CompanyHeadListResponse(BaseModel):
    items: list[CompanyHeadRead]
    meta: PaginationMeta
