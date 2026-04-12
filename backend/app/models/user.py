from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base_mixins import TimestampMixin
from app.models.enums import UserRole

if TYPE_CHECKING:
    from app.models.audit_log import AuditLog
    from app.models.company import Company
    from app.models.company_head import CompanyHead
    from app.models.department_manager import DepartmentManager
    from app.models.employee import Employee
    from app.models.invitation import Invitation
    from app.models.system_admin_profile import SystemAdminProfile


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    invited_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    system_admin_profile: Mapped["SystemAdminProfile | None"] = relationship(
        back_populates="user", uselist=False, foreign_keys="SystemAdminProfile.user_id"
    )
    company_head_profile: Mapped["CompanyHead | None"] = relationship(back_populates="user", uselist=False)
    department_manager_profile: Mapped["DepartmentManager | None"] = relationship(back_populates="user", uselist=False)
    employee_profile: Mapped["Employee | None"] = relationship(back_populates="user", uselist=False)
    created_companies: Mapped[list["Company"]] = relationship(back_populates="created_by_user")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="actor_user")
    invitations: Mapped[list["Invitation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True, foreign_keys="Invitation.user_id"
    )
    created_invitations: Mapped[list["Invitation"]] = relationship(
        back_populates="created_by_user",
        foreign_keys="Invitation.created_by_user_id",
    )
    invited_by_user: Mapped["User | None"] = relationship(
        remote_side=[id], foreign_keys=[invited_by_user_id], back_populates="invited_users"
    )
    invited_users: Mapped[list["User"]] = relationship(
        back_populates="invited_by_user",
        foreign_keys=[invited_by_user_id],
    )
