from datetime import datetime

from app.schemas.common import ORMBase


class AvailableConsultantRead(ORMBase):
    user_id: int
    full_name: str
    professional_title: str | None
    specialization: str | None
    bio: str | None


class StartConsultationRequest(ORMBase):
    consultant_user_id: int


class ThreadMessageRead(ORMBase):
    id: int
    sender_role: str
    message_body: str
    created_at: datetime


class ConsultationThreadRead(ORMBase):
    id: int
    anonymous_alias: str
    status: str
    message_count: int
    last_message_at: datetime | None
    created_at: datetime


class ConsultationThreadDetail(ORMBase):
    id: int
    anonymous_alias: str
    status: str
    created_at: datetime
    messages: list[ThreadMessageRead]


class SendMessageRequest(ORMBase):
    message_body: str


class UpdateThreadStatusRequest(ORMBase):
    status: str


class StartConsultationResponse(ORMBase):
    thread_id: int
    anonymous_alias: str
    status: str
