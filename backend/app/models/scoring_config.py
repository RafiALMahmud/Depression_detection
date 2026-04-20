from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class ScoringConfig(Base, TimestampMixin):
    __tablename__ = "scoring_configs"
    __table_args__ = (
        CheckConstraint("facial_weight >= 0 AND facial_weight <= 1", name="ck_scoring_facial_weight_range"),
        CheckConstraint(
            "questionnaire_weight >= 0 AND questionnaire_weight <= 1",
            name="ck_scoring_questionnaire_weight_range",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    facial_weight: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.5")
    questionnaire_weight: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.5")
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    updated_by_user: Mapped["User | None"] = relationship(foreign_keys=[updated_by_user_id])
