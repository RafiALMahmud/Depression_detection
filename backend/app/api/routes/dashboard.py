from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.company import Company
from app.models.company_head import CompanyHead
from app.models.department import Department
from app.models.department_manager import DepartmentManager
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.system_admin_profile import SystemAdminProfile
from app.models.user import User
from app.schemas.dashboard import SuperAdminSummary, SystemAdminSummary

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get(
    "/super-admin/summary",
    response_model=SuperAdminSummary,
)
def get_super_admin_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SuperAdminSummary:
    return SuperAdminSummary(
        total_system_admins=db.scalar(select(func.count(SystemAdminProfile.id))) or 0,
        total_companies=db.scalar(select(func.count(Company.id))) or 0,
        total_company_heads=db.scalar(select(func.count(CompanyHead.id))) or 0,
        total_departments=db.scalar(select(func.count(Department.id))) or 0,
        total_department_managers=db.scalar(select(func.count(DepartmentManager.id))) or 0,
        total_employees=db.scalar(select(func.count(Employee.id))) or 0,
    )


@router.get(
    "/system-admin/summary",
    response_model=SystemAdminSummary,
)
def get_system_admin_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> SystemAdminSummary:
    return SystemAdminSummary(
        total_companies=db.scalar(select(func.count(Company.id))) or 0,
        total_company_heads=db.scalar(select(func.count(CompanyHead.id))) or 0,
        total_departments=db.scalar(select(func.count(Department.id))) or 0,
        total_department_managers=db.scalar(select(func.count(DepartmentManager.id))) or 0,
        total_employees=db.scalar(select(func.count(Employee.id))) or 0,
    )

