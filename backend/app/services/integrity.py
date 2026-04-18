from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.models.company_head import CompanyHead
from app.models.department import Department
from app.models.department_manager import DepartmentManager
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.invitation import Invitation
from app.models.user import User
from app.services.hierarchy import (
    get_company_head_profile_for_user_or_403,
    get_department_manager_profile_for_user_or_403,
)


def repair_schema_compatibility(db: Session) -> dict[str, int]:
    """
    Lightweight startup schema compatibility guard.
    Handles additive hotfixes for environments where tables were created before
    the latest migration was applied.
    """
    report = {
        "employee_compliance_status_added": 0,
    }

    bind = db.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "employees" in table_names:
        employee_columns = {column["name"] for column in inspector.get_columns("employees")}
        if "compliance_status" not in employee_columns:
            db.execute(
                text(
                    "ALTER TABLE employees "
                    "ADD COLUMN compliance_status VARCHAR(20) NOT NULL DEFAULT 'pending'"
                )
            )
            report["employee_compliance_status_added"] = 1

    db.flush()
    return report


def repair_database_integrity(db: Session) -> dict[str, int]:
    """
    Lightweight startup repair for common consistency leaks.
    Keeps role-profile mapping and hierarchy relations coherent.
    """
    report = {
        "company_head_profiles_restored": 0,
        "department_manager_profiles_restored": 0,
        "orphan_demo_users_deleted": 0,
        "department_manager_company_synced": 0,
        "employee_company_synced": 0,
        "invitation_company_synced": 0,
    }

    company_head_users = db.scalars(select(User).where(User.role == UserRole.COMPANY_HEAD)).all()
    for user in company_head_users:
        profile = db.scalar(select(CompanyHead).where(CompanyHead.user_id == user.id))
        if profile:
            continue
        try:
            get_company_head_profile_for_user_or_403(db, user)
            report["company_head_profiles_restored"] += 1
        except Exception:
            # Keep unresolved account untouched; it will surface explicit UI/API message.
            continue

    department_manager_users = db.scalars(select(User).where(User.role == UserRole.DEPARTMENT_MANAGER)).all()
    for user in department_manager_users:
        profile = db.scalar(select(DepartmentManager).where(DepartmentManager.user_id == user.id))
        if profile:
            continue
        try:
            get_department_manager_profile_for_user_or_403(db, user)
            report["department_manager_profiles_restored"] += 1
        except Exception:
            continue

    # Drop orphan demo-only role users that have no profile linkage.
    orphan_demo_company_heads = db.scalars(
        select(User)
        .outerjoin(CompanyHead, CompanyHead.user_id == User.id)
        .where(
            User.role == UserRole.COMPANY_HEAD,
            User.email.endswith("@mindwell.demo"),
            CompanyHead.id.is_(None),
        )
    ).all()
    orphan_demo_department_managers = db.scalars(
        select(User)
        .outerjoin(DepartmentManager, DepartmentManager.user_id == User.id)
        .where(
            User.role == UserRole.DEPARTMENT_MANAGER,
            User.email.endswith("@mindwell.demo"),
            DepartmentManager.id.is_(None),
        )
    ).all()
    for user in [*orphan_demo_company_heads, *orphan_demo_department_managers]:
        db.delete(user)
        report["orphan_demo_users_deleted"] += 1

    # Keep company_id consistent with department ownership.
    for manager in db.scalars(select(DepartmentManager)).all():
        department = manager.department
        if department and manager.company_id != department.company_id:
            manager.company_id = department.company_id
            report["department_manager_company_synced"] += 1

    for employee in db.scalars(select(Employee)).all():
        department = employee.department
        if department and employee.company_id != department.company_id:
            employee.company_id = department.company_id
            report["employee_company_synced"] += 1

    for invitation in db.scalars(select(Invitation).where(Invitation.department_id.is_not(None))).all():
        department = invitation.department
        if department and invitation.company_id != department.company_id:
            invitation.company_id = department.company_id
            report["invitation_company_synced"] += 1

    db.flush()
    return report
