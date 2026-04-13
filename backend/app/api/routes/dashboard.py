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
from app.models.enums import InvitationStatus, UserRole
from app.models.invitation import Invitation
from app.models.system_admin_profile import SystemAdminProfile
from app.models.user import User
from app.schemas.dashboard import (
    CompanyDepartmentBreakdown,
    CompanyHeadSummary,
    DepartmentManagerSummary,
    SummaryInvitationPreview,
    SummaryUserPreview,
    SuperAdminSummary,
    SystemAdminSummary,
)
from app.services.hierarchy import (
    get_company_head_profile_for_user_or_403,
    get_company_or_404,
    get_department_manager_profile_for_user_or_403,
    get_department_or_404,
)

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


@router.get(
    "/company-head/summary",
    response_model=CompanyHeadSummary,
)
def get_company_head_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.COMPANY_HEAD)),
) -> CompanyHeadSummary:
    profile = get_company_head_profile_for_user_or_403(db, current_user)
    company = get_company_or_404(db, profile.company_id)

    total_departments = db.scalar(select(func.count(Department.id)).where(Department.company_id == profile.company_id)) or 0
    total_department_managers = (
        db.scalar(select(func.count(DepartmentManager.id)).where(DepartmentManager.company_id == profile.company_id)) or 0
    )
    total_employees = db.scalar(select(func.count(Employee.id)).where(Employee.company_id == profile.company_id)) or 0
    active_invitations_count = (
        db.scalar(
            select(func.count(Invitation.id)).where(
                Invitation.company_id == profile.company_id,
                Invitation.role.in_([UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE]),
                Invitation.status == InvitationStatus.PENDING,
            )
        )
        or 0
    )
    completed_onboardings_count = (
        db.scalar(
            select(func.count(Employee.id))
            .join(Employee.user)
            .where(Employee.company_id == profile.company_id, User.is_active.is_(True))
        )
        or 0
    ) + (
        db.scalar(
            select(func.count(DepartmentManager.id))
            .join(DepartmentManager.user)
            .where(DepartmentManager.company_id == profile.company_id, User.is_active.is_(True))
        )
        or 0
    )

    recent_invitation_rows = db.execute(
        select(Invitation, User.full_name)
        .join(Invitation.user)
        .where(
            Invitation.company_id == profile.company_id,
            Invitation.role.in_([UserRole.DEPARTMENT_MANAGER, UserRole.EMPLOYEE]),
        )
        .order_by(Invitation.created_at.desc())
        .limit(5)
    ).all()
    recent_invitations = [
        SummaryInvitationPreview(
            id=invitation.id,
            full_name=full_name,
            email=invitation.email,
            role=invitation.role,
            status=invitation.status,
            sent_at=invitation.sent_at,
            expires_at=invitation.expires_at,
            created_at=invitation.created_at,
        )
        for invitation, full_name in recent_invitation_rows
    ]

    department_breakdown_rows = db.execute(
        select(
            Department.id,
            Department.name,
            Department.code,
            func.count(func.distinct(DepartmentManager.id)),
            func.count(Employee.id),
        )
        .outerjoin(DepartmentManager, DepartmentManager.department_id == Department.id)
        .outerjoin(Employee, Employee.department_id == Department.id)
        .where(Department.company_id == profile.company_id)
        .group_by(Department.id, Department.name, Department.code)
        .order_by(Department.name.asc())
    ).all()
    department_breakdown = [
        CompanyDepartmentBreakdown(
            department_id=department_id,
            department_name=department_name,
            department_code=department_code,
            department_manager_count=department_manager_count,
            employee_count=employee_count,
        )
        for department_id, department_name, department_code, department_manager_count, employee_count in department_breakdown_rows
    ]

    recent_employee_rows = db.execute(
        select(Employee.id, User.full_name, User.email, Employee.created_at)
        .join(Employee.user)
        .where(Employee.company_id == profile.company_id)
        .order_by(Employee.created_at.desc())
        .limit(5)
    ).all()
    recent_employees = [
        SummaryUserPreview(id=employee_id, full_name=full_name, email=email, created_at=created_at)
        for employee_id, full_name, email, created_at in recent_employee_rows
    ]

    return CompanyHeadSummary(
        company_id=company.id,
        company_name=company.name,
        total_departments=total_departments,
        total_department_managers=total_department_managers,
        total_employees=total_employees,
        active_invitations_count=active_invitations_count,
        completed_onboardings_count=completed_onboardings_count,
        department_breakdown=department_breakdown,
        recent_invitations=recent_invitations,
        recent_employees=recent_employees,
    )


@router.get(
    "/department-manager/summary",
    response_model=DepartmentManagerSummary,
)
def get_department_manager_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> DepartmentManagerSummary:
    profile = get_department_manager_profile_for_user_or_403(db, current_user)
    company = get_company_or_404(db, profile.company_id)
    department = get_department_or_404(db, profile.department_id)

    total_employees = (
        db.scalar(select(func.count(Employee.id)).where(Employee.company_id == profile.company_id, Employee.department_id == profile.department_id))
        or 0
    )
    active_invitations_count = (
        db.scalar(
            select(func.count(Invitation.id)).where(
                Invitation.company_id == profile.company_id,
                Invitation.department_id == profile.department_id,
                Invitation.role == UserRole.EMPLOYEE,
                Invitation.status == InvitationStatus.PENDING,
            )
        )
        or 0
    )
    completed_onboardings_count = (
        db.scalar(
            select(func.count(Employee.id))
            .join(Employee.user)
            .where(
                Employee.company_id == profile.company_id,
                Employee.department_id == profile.department_id,
                User.is_active.is_(True),
            )
        )
        or 0
    )

    recent_invitation_rows = db.execute(
        select(Invitation, User.full_name)
        .join(Invitation.user)
        .where(
            Invitation.company_id == profile.company_id,
            Invitation.department_id == profile.department_id,
            Invitation.role == UserRole.EMPLOYEE,
        )
        .order_by(Invitation.created_at.desc())
        .limit(5)
    ).all()
    recent_invitations = [
        SummaryInvitationPreview(
            id=invitation.id,
            full_name=full_name,
            email=invitation.email,
            role=invitation.role,
            status=invitation.status,
            sent_at=invitation.sent_at,
            expires_at=invitation.expires_at,
            created_at=invitation.created_at,
        )
        for invitation, full_name in recent_invitation_rows
    ]

    recent_employee_rows = db.execute(
        select(Employee.id, User.full_name, User.email, Employee.created_at)
        .join(Employee.user)
        .where(Employee.company_id == profile.company_id, Employee.department_id == profile.department_id)
        .order_by(Employee.created_at.desc())
        .limit(5)
    ).all()
    recent_employees = [
        SummaryUserPreview(id=employee_id, full_name=full_name, email=email, created_at=created_at)
        for employee_id, full_name, email, created_at in recent_employee_rows
    ]

    return DepartmentManagerSummary(
        company_id=company.id,
        company_name=company.name,
        department_id=department.id,
        department_name=department.name,
        total_employees=total_employees,
        active_invitations_count=active_invitations_count,
        completed_onboardings_count=completed_onboardings_count,
        scanned_employees_count_placeholder=0,
        average_wellness_score_placeholder=None,
        recent_invitations=recent_invitations,
        recent_employees=recent_employees,
    )
