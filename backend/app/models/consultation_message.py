from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.consultation_thread import ConsultationThread


class ConsultationMessage(Base, TimestampMixin):
    __tablename__ = "consultation_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("consultation_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_role: Mapped[str] = mapped_column(String(30), nullable=False)
    sender_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    message_body: Mapped[str] = mapped_column(Text, nullable=False)

    thread: Mapped["ConsultationThread"] = relationship(back_populates="messages")
