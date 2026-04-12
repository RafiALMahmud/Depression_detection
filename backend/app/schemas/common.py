import math
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=10, ge=1, le=100)
    search: str | None = Field(default=None, max_length=120)


class PaginationMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int

    @classmethod
    def create(cls, page: int, page_size: int, total: int) -> "PaginationMeta":
        return cls(page=page, page_size=page_size, total=total, total_pages=max(1, math.ceil(total / page_size)))


class ApiMessage(BaseModel):
    message: str


class EmailValidatedModel(BaseModel):
    @field_validator("email", check_fields=False)
    @classmethod
    def validate_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("Invalid email address")
        return email
