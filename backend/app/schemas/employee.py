from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import EMAIL_PATTERN, ORMBase, PaginationMeta
from app.schemas.invitation import InvitationSnapshot
from app.schemas.user import UserRead


class EmployeeCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: str
    company_id: int = Field(ge=1)
    department_id: int = Field(ge=1)
    employee_code: str | None = Field(default=None, max_length=64)
    job_title: str | None = Field(default=None, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email

    @field_validator("employee_code")
    @classmethod
    def normalize_employee_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        return normalized or None

class EmployeeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    email: str | None = None
    company_id: int | None = Field(default=None, ge=1)
    department_id: int | None = Field(default=None, ge=1)
    employee_code: str | None = Field(default=None, max_length=64)
    job_title: str | None = Field(default=None, max_length=128)
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

    @field_validator("employee_code")
    @classmethod
    def normalize_employee_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().upper()
        return normalized or None

class EmployeeRead(ORMBase):
    id: int
    user: UserRead
    company_id: int
    department_id: int
    employee_code: str | None
    job_title: str | None
    invitation: InvitationSnapshot | None = None
    created_at: datetime
    updated_at: datetime


class EmployeeListResponse(BaseModel):
    items: list[EmployeeRead]
    meta: PaginationMeta
