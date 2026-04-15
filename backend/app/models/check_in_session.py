from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.employee import Employee
    from app.models.questionnaire_response import QuestionnaireResponse


class CheckInSession(Base):
    __tablename__ = "check_in_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )

    facial_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    facial_emotions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    questionnaire_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    composite_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_tier: Mapped[str | None] = mapped_column(String(20), nullable=True)

    score_weight_facial: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.5")
    score_weight_questionnaire: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.5")

    questions_asked: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="in_progress")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    employee: Mapped["Employee"] = relationship(back_populates="check_in_sessions")
    responses: Mapped[list["QuestionnaireResponse"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="QuestionnaireResponse.sequence_order"
    )
