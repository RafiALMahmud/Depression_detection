from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.department import Department
    from app.models.user import User


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_code: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    job_title: Mapped[str | None] = mapped_column(String(128), nullable=True)

    user: Mapped["User"] = relationship(back_populates="employee_profile", foreign_keys=[user_id])
    company: Mapped["Company"] = relationship(back_populates="employees")
    department: Mapped["Department"] = relationship(back_populates="employees")

