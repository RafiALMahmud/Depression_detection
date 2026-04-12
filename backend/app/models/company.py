from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.company_head import CompanyHead
    from app.models.department import Department
    from app.models.department_manager import DepartmentManager
    from app.models.employee import Employee
    from app.models.invitation import Invitation
    from app.models.user import User


class Company(Base, TimestampMixin):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_by_user: Mapped["User | None"] = relationship(back_populates="created_companies")
    departments: Mapped[list["Department"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", passive_deletes=True
    )
    company_head: Mapped["CompanyHead | None"] = relationship(
        back_populates="company", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    department_managers: Mapped[list["DepartmentManager"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", passive_deletes=True
    )
    employees: Mapped[list["Employee"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", passive_deletes=True
    )
    invitations: Mapped[list["Invitation"]] = relationship(
        back_populates="company",
        passive_deletes=True,
    )
