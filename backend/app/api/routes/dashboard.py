import math
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.check_in_session import CheckInSession
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
    DepartmentComparisonItem,
    DepartmentHealthIndicator,
    DepartmentManagerAnalytics,
    DepartmentManagerSummary,
    DepartmentTierBreakdownItem,
    DepartmentWeeklyAverageItem,
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
TIER_ORDER = ("low", "moderate", "high", "severe")


def _week_start_utc(today: datetime | None = None) -> datetime:
    reference = (today or datetime.now(timezone.utc)).date()
    monday = reference - timedelta(days=reference.weekday())
    return datetime.combine(monday, time.min, tzinfo=timezone.utc)


def _event_time(session: CheckInSession) -> datetime | None:
    return session.completed_at or session.created_at


def _health_indicator(current_average: float | None) -> DepartmentHealthIndicator:
    if current_average is None:
        return DepartmentHealthIndicator(
            color="amber",
            label="Amber",
            reason="No completed sessions were recorded for the current week.",
        )
    if current_average <= 25:
        return DepartmentHealthIndicator(
            color="green",
            label="Green",
            reason="Current weekly average remains within low-risk range.",
        )
    if current_average <= 50:
        return DepartmentHealthIndicator(
            color="amber",
            label="Amber",
            reason="Current weekly average is in moderate range and should be monitored.",
        )
    return DepartmentHealthIndicator(
        color="red",
        label="Red",
        reason="Current weekly average is high-risk and needs intervention.",
    )


def _trend_label(delta: float | None) -> str:
    if delta is None:
        return "no_data"
    # Lower composite score is better.
    if delta <= -3:
        return "improving"
    if delta >= 3:
        return "worsening"
    return "stable"


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

    employee_ids = [
        employee_id
        for (employee_id,) in db.execute(
            select(Employee.id).where(
                Employee.company_id == profile.company_id,
                Employee.department_id == profile.department_id,
            )
        ).all()
    ]

    scanned_employees_count = 0
    average_wellness_score = None
    if employee_ids:
        scored_employee_ids = db.execute(
            select(CheckInSession.employee_id)
            .where(
                CheckInSession.employee_id.in_(employee_ids),
                CheckInSession.status == "completed",
                CheckInSession.composite_score.is_not(None),
            )
            .distinct()
        ).all()
        scanned_employees_count = len(scored_employee_ids)
        average_wellness_score = db.scalar(
            select(func.avg(CheckInSession.composite_score)).where(
                CheckInSession.employee_id.in_(employee_ids),
                CheckInSession.status == "completed",
                CheckInSession.composite_score.is_not(None),
            )
        )

    return DepartmentManagerSummary(
        company_id=company.id,
        company_name=company.name,
        department_id=department.id,
        department_name=department.name,
        total_employees=total_employees,
        active_invitations_count=active_invitations_count,
        completed_onboardings_count=completed_onboardings_count,
        scanned_employees_count_placeholder=scanned_employees_count,
        average_wellness_score_placeholder=round(float(average_wellness_score), 2)
        if average_wellness_score is not None
        else None,
        recent_invitations=recent_invitations,
        recent_employees=recent_employees,
    )


@router.get(
    "/department-manager/analytics",
    response_model=DepartmentManagerAnalytics,
)
def get_department_manager_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> DepartmentManagerAnalytics:
    profile = get_department_manager_profile_for_user_or_403(db, current_user)
    generated_at = datetime.now(timezone.utc)

    department_rows = db.execute(
        select(Department.id).where(Department.company_id == profile.company_id).order_by(Department.id.asc())
    ).all()
    company_department_ids = [department_id for (department_id,) in department_rows]
    anonymized_code_map = {
        department_id: f"DEPT-{index:02d}"
        for index, department_id in enumerate(company_department_ids, start=1)
    }

    employee_rows = db.execute(
        select(Employee.id, Employee.department_id).where(Employee.company_id == profile.company_id)
    ).all()
    company_employee_ids = [employee_id for employee_id, _ in employee_rows]
    employee_department_map = {employee_id: department_id for employee_id, department_id in employee_rows}
    department_employee_ids: dict[int, list[int]] = {department_id: [] for department_id in company_department_ids}
    for employee_id, department_id in employee_rows:
        department_employee_ids.setdefault(department_id, []).append(employee_id)

    session_rows = []
    if company_employee_ids:
        session_rows = db.execute(
            select(
                CheckInSession.id,
                CheckInSession.employee_id,
                CheckInSession.composite_score,
                CheckInSession.threshold_tier,
                CheckInSession.created_at,
                CheckInSession.completed_at,
            ).where(
                CheckInSession.employee_id.in_(company_employee_ids),
                CheckInSession.status == "completed",
                CheckInSession.composite_score.is_not(None),
            )
            .order_by(
                CheckInSession.employee_id.asc(),
                func.coalesce(CheckInSession.completed_at, CheckInSession.created_at).desc(),
                CheckInSession.id.desc(),
            )
        ).all()

    latest_session_by_employee: dict[int, object] = {}
    for row in session_rows:
        employee_id = int(row.employee_id)
        if employee_id not in latest_session_by_employee:
            latest_session_by_employee[employee_id] = row

    current_department_employee_ids = department_employee_ids.get(profile.department_id, [])
    current_department_latest_rows = [
        latest_session_by_employee[employee_id]
        for employee_id in current_department_employee_ids
        if employee_id in latest_session_by_employee
    ]

    tier_counts = {tier: 0 for tier in TIER_ORDER}
    for row in current_department_latest_rows:
        tier = str(row.threshold_tier or "").lower()
        if tier in tier_counts:
            tier_counts[tier] += 1

    total_employees = len(current_department_employee_ids)
    employees_with_scores = len(current_department_latest_rows)
    threshold_distribution = [
        DepartmentTierBreakdownItem(
            tier=tier,
            count=tier_counts[tier],
            percentage=round((tier_counts[tier] / total_employees) * 100, 2) if total_employees else 0.0,
        )
        for tier in TIER_ORDER
    ]

    department_session_rows = [
        row for row in session_rows if employee_department_map.get(int(row.employee_id)) == profile.department_id
    ]
    current_week_start = _week_start_utc(generated_at)
    weekly_averages: list[DepartmentWeeklyAverageItem] = []
    for week_offset in range(4, -1, -1):
        week_start = current_week_start - timedelta(weeks=week_offset)
        week_end = week_start + timedelta(days=7)

        week_scores: list[float] = []
        for row in department_session_rows:
            event_time = row.completed_at or row.created_at
            if event_time is None:
                continue
            if week_start <= event_time < week_end:
                week_scores.append(float(row.composite_score))

        weekly_averages.append(
            DepartmentWeeklyAverageItem(
                week_start=week_start,
                week_end=week_end - timedelta(seconds=1),
                average_composite_score=round(sum(week_scores) / len(week_scores), 2) if week_scores else None,
                session_count=len(week_scores),
            )
        )

    current_week_average = weekly_averages[-1].average_composite_score if weekly_averages else None
    previous_week_average = weekly_averages[-2].average_composite_score if len(weekly_averages) > 1 else None
    week_over_week_delta = (
        round(current_week_average - previous_week_average, 2)
        if current_week_average is not None and previous_week_average is not None
        else None
    )
    week_over_week_trend = _trend_label(week_over_week_delta)
    health_indicator = _health_indicator(current_week_average)

    comparison_raw = []
    for department_id in company_department_ids:
        employee_ids = department_employee_ids.get(department_id, [])
        latest_rows = [
            latest_session_by_employee[employee_id]
            for employee_id in employee_ids
            if employee_id in latest_session_by_employee
        ]
        scores = [float(row.composite_score) for row in latest_rows if row.composite_score is not None]
        average_score = round(sum(scores) / len(scores), 2) if scores else None
        comparison_raw.append(
            {
                "department_id": department_id,
                "average_composite_score": average_score,
                "total_employees": len(employee_ids),
                "employees_with_scores": len(scores),
            }
        )

    company_scored_departments = [
        float(item["average_composite_score"])
        for item in comparison_raw
        if item["average_composite_score"] is not None
    ]
    company_average = (
        round(sum(company_scored_departments) / len(company_scored_departments), 2)
        if company_scored_departments
        else None
    )
    company_std_dev = None
    if company_scored_departments:
        mean = float(sum(company_scored_departments) / len(company_scored_departments))
        variance = sum((score - mean) ** 2 for score in company_scored_departments) / len(company_scored_departments)
        company_std_dev = round(math.sqrt(variance), 4)

    comparison_items: list[DepartmentComparisonItem] = []
    for item in comparison_raw:
        score = item["average_composite_score"]
        if score is None or company_average is None or not company_std_dev:
            outlier_status = "insufficient_data"
        else:
            z_score = (float(score) - float(company_average)) / float(company_std_dev)
            if z_score >= 1:
                outlier_status = "higher_than_company_average"
            elif z_score <= -1:
                outlier_status = "lower_than_company_average"
            else:
                outlier_status = "within_expected_range"

        comparison_items.append(
            DepartmentComparisonItem(
                anonymized_department_code=anonymized_code_map.get(item["department_id"], "DEPT-00"),
                average_composite_score=score,
                total_employees=int(item["total_employees"]),
                employees_with_scores=int(item["employees_with_scores"]),
                is_current_department=int(item["department_id"]) == profile.department_id,
                outlier_status=outlier_status,
            )
        )

    return DepartmentManagerAnalytics(
        company_id=profile.company_id,
        department_id=profile.department_id,
        department_anonymized_code=anonymized_code_map.get(profile.department_id, "DEPT-00"),
        total_employees=total_employees,
        employees_with_scores=employees_with_scores,
        threshold_distribution=threshold_distribution,
        weekly_averages=weekly_averages,
        current_week_average=current_week_average,
        previous_week_average=previous_week_average,
        week_over_week_delta=week_over_week_delta,
        week_over_week_trend=week_over_week_trend,
        health_indicator=health_indicator,
        company_average_composite=company_average,
        company_std_dev_composite=company_std_dev,
        cross_department_comparison=comparison_items,
        generated_at=generated_at,
    )
