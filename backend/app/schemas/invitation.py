from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import InvitationStatus, UserRole
from app.schemas.common import EMAIL_PATTERN, ORMBase


class InvitationSnapshot(ORMBase):
    id: int
    status: InvitationStatus
    expires_at: datetime | None
    sent_at: datetime | None
    used_at: datetime | None
    created_at: datetime
    updated_at: datetime


class InvitationValidateRequest(BaseModel):
    email: str
    invitation_code: str = Field(min_length=9, max_length=9)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email

    @field_validator("invitation_code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not value.isdigit() or len(value) != 9:
            raise ValueError("Invitation code must be a 9-digit number")
        return value


class InvitationValidateResponse(BaseModel):
    valid: bool
    message: str
    role: UserRole | None = None
    company_name: str | None = None
    department_name: str | None = None
    full_name: str | None = None
    email: str | None = None
    expires_at: datetime | None = None
    status: InvitationStatus | None = None


class InvitationSignupRequest(BaseModel):
    email: str
    invitation_code: str = Field(min_length=9, max_length=9)
    full_name: str = Field(min_length=2, max_length=150)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email

    @field_validator("invitation_code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not value.isdigit() or len(value) != 9:
            raise ValueError("Invitation code must be a 9-digit number")
        return value


class InvitationSignupResponse(BaseModel):
    message: str
    role: UserRole


class InvitationActionResponse(BaseModel):
    message: str
    invitation: InvitationSnapshot

