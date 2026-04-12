from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.department_manager import DepartmentManager
    from app.models.employee import Employee
    from app.models.invitation import Invitation


class Department(Base, TimestampMixin):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_department_company_code"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    company: Mapped["Company"] = relationship(back_populates="departments")
    department_manager: Mapped["DepartmentManager | None"] = relationship(
        back_populates="department", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    employees: Mapped[list["Employee"]] = relationship(
        back_populates="department", cascade="all, delete-orphan", passive_deletes=True
    )
    invitations: Mapped[list["Invitation"]] = relationship(
        back_populates="department",
        passive_deletes=True,
    )
