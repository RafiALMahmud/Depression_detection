from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.user import User


class CompanyHead(Base, TimestampMixin):
    __tablename__ = "company_heads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), unique=True, nullable=False)

    user: Mapped["User"] = relationship(back_populates="company_head_profile", foreign_keys=[user_id])
    company: Mapped["Company"] = relationship(back_populates="company_head")

