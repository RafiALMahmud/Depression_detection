from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMBase, PaginationMeta


class CompanyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    code: str = Field(min_length=2, max_length=50)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip().upper()


class CompanyRead(ORMBase):
    id: int
    name: str
    code: str
    description: str | None
    is_active: bool
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime


class CompanyOption(ORMBase):
    id: int
    name: str
    code: str


class CompanyListResponse(BaseModel):
    items: list[CompanyRead]
    meta: PaginationMeta

