from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import UserRole
from app.schemas.common import ORMBase


class UserRead(ORMBase):
    id: int
    full_name: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserSummary(BaseModel):
    id: int
    full_name: str
    email: str
    is_active: bool = Field(default=True)

