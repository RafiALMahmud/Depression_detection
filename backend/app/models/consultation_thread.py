from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.consultation_message import ConsultationMessage
    from app.models.user import User


class ConsultationThread(Base, TimestampMixin):
    __tablename__ = "consultation_threads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    consultant_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    anonymous_alias: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="open", index=True)

    company: Mapped["Company"] = relationship(foreign_keys=[company_id])
    employee: Mapped["User"] = relationship(foreign_keys=[employee_user_id])
    consultant: Mapped["User | None"] = relationship(foreign_keys=[consultant_user_id])
    messages: Mapped[list["ConsultationMessage"]] = relationship(back_populates="thread", cascade="all, delete-orphan")
