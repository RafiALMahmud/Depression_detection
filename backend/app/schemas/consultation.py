from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import PaginationMeta


class ConsultationTeamConfigRead(BaseModel):
    company_id: int
    is_enabled: bool
    provider_name: str | None
    contact_email: str | None
    guidance_note: str | None
    updated_at: datetime | None


class ConsultationTeamConfigUpdate(BaseModel):
    is_enabled: bool
    provider_name: str | None = Field(default=None, max_length=150)
    contact_email: str | None = Field(default=None, max_length=255)
    guidance_note: str | None = Field(default=None, max_length=400)

    @field_validator("provider_name", "contact_email", "guidance_note")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ConsultationRequestCreate(BaseModel):
    session_id: int | None = Field(default=None, ge=1)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ConsultationRequestSchedule(BaseModel):
    scheduled_for: datetime
    scheduler_note: str | None = Field(default=None, max_length=500)

    @field_validator("scheduler_note")
    @classmethod
    def normalize_scheduler_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ConsultationRequestRead(BaseModel):
    id: int
    company_id: int
    employee_id: int
    source_session_id: int | None
    threshold_tier: str
    status: str
    note: str | None
    scheduler_note: str | None
    scheduled_for: datetime | None
    created_at: datetime
    updated_at: datetime


class ConsultationQueueItemRead(BaseModel):
    id: int
    company_id: int
    employee_id: int
    source_session_id: int | None
    employee_name: str
    employee_email: str
    threshold_tier: str
    status: str
    note: str | None
    scheduler_note: str | None
    scheduled_for: datetime | None
    created_at: datetime
    updated_at: datetime


class ConsultationQueueListResponse(BaseModel):
    items: list[ConsultationQueueItemRead]
    meta: PaginationMeta
