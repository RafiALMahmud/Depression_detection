from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.check_in_session import CheckInSession
    from app.models.company import Company
    from app.models.employee import Employee
    from app.models.user import User


class CounselorConsultationRequest(Base):
    __tablename__ = "counselor_consultation_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_session_id: Mapped[int | None] = mapped_column(
        ForeignKey("check_in_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    threshold_tier: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    request_note_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default="pending", index=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduler_note_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheduled_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    company: Mapped["Company"] = relationship()
    employee: Mapped["Employee"] = relationship()
    source_session: Mapped["CheckInSession | None"] = relationship()
    scheduled_by_user: Mapped["User | None"] = relationship(foreign_keys=[scheduled_by_user_id])
