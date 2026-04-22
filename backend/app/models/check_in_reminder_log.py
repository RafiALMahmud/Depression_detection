from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.employee import Employee


class CheckInReminderLog(Base):
    __tablename__ = "check_in_reminder_logs"
    __table_args__ = (
        UniqueConstraint(
            "employee_id",
            "reminder_for_date",
            "reminder_type",
            name="uq_checkin_reminder_employee_date_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reminder_type: Mapped[str] = mapped_column(String(40), nullable=False, server_default="next_session")
    reminder_for_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    next_session_date: Mapped[date] = mapped_column(Date, nullable=False)
    days_since_last_checkin: Mapped[int] = mapped_column(nullable=False)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    employee: Mapped["Employee"] = relationship(back_populates="check_in_reminder_logs")
