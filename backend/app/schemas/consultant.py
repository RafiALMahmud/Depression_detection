from datetime import datetime

from pydantic import EmailStr

from app.schemas.common import ORMBase
from app.schemas.invitation import InvitationSnapshot
from app.schemas.user import UserRead


class ConsultantCreate(ORMBase):
    full_name: str
    email: EmailStr
    company_id: int
    professional_title: str | None = None
    specialization: str | None = None
    bio: str | None = None


class ConsultantUpdate(ORMBase):
    full_name: str | None = None
    professional_title: str | None = None
    specialization: str | None = None
    bio: str | None = None
    is_active: bool | None = None


class ConsultantRead(ORMBase):
    id: int
    user: UserRead
    company_id: int
    company_name: str | None = None
    professional_title: str | None = None
    specialization: str | None = None
    bio: str | None = None
    is_active: bool
    invitation: InvitationSnapshot | None = None
    created_at: datetime
    updated_at: datetime


class ConsultantListResponse(ORMBase):
    items: list[ConsultantRead]
    total: int


class ConsultantDashboardSummary(ORMBase):
    company_name: str
    professional_title: str | None
    specialization: str | None
    active_threads: int
    pending_threads: int
    resolved_threads: int
    advised_employees_count: int
