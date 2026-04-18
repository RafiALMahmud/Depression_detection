from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.check_in_session import CheckInSession
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.report import Report
from app.models.user import User
from app.schemas.report import (
    DepartmentReportSummary,
    FlaggedEmployeeEntry,
    ReportListResponse,
    ReportPreview,
    ReportRead,
    ReportSubmitRequest,
)
from app.services.hierarchy import get_department_manager_profile_for_user_or_403

router = APIRouter(prefix="/reports", tags=["Reports"])

HIGH_SEVERITY_TIERS = {"high", "severe"}


def _latest_session_per_employee(db: Session, department_id: int) -> dict[int, CheckInSession]:
    employees = db.query(Employee).filter(Employee.department_id == department_id).all()
    result: dict[int, CheckInSession] = {}
    for emp in employees:
        latest = (
            db.query(CheckInSession)
            .filter(
                CheckInSession.employee_id == emp.id,
                CheckInSession.status == "completed",
            )
            .order_by(CheckInSession.created_at.desc())
            .first()
        )
        if latest:
            result[emp.id] = latest
    return result


def _build_preview(db: Session, department_id: int, company_id: int) -> tuple[DepartmentReportSummary, list[FlaggedEmployeeEntry]]:
    employees = db.query(Employee).filter(Employee.department_id == department_id).all()
    total = len(employees)
    latest_sessions = _latest_session_per_employee(db, department_id)

    flagged: list[FlaggedEmployeeEntry] = []
    composite_scores: list[float] = []
    compliant_count = sum(1 for e in employees if e.compliance_status == "compliant")

    for idx, emp in enumerate(employees, start=1):
        session = latest_sessions.get(emp.id)
        if session and session.composite_score is not None:
            composite_scores.append(session.composite_score)
        if session and session.threshold_tier in HIGH_SEVERITY_TIERS:
            flagged.append(FlaggedEmployeeEntry(
                anonymized_id=f"EMP-{idx:03d}",
                threshold_tier=session.threshold_tier,
                composite_score=session.composite_score,
                facial_score=session.facial_score,
                questionnaire_score=session.questionnaire_score,
                sessions_count=db.query(CheckInSession).filter(
                    CheckInSession.employee_id == emp.id,
                    CheckInSession.status == "completed",
                ).count(),
            ))

    avg_score = round(sum(composite_scores) / len(composite_scores), 2) if composite_scores else None
    summary = DepartmentReportSummary(
        total_employees=total,
        flagged_count=len(flagged),
        compliant_count=compliant_count,
        average_composite_score=avg_score,
    )
    return summary, flagged


def _serialize_report(report: Report) -> ReportRead:
    manager_name = report.manager.full_name if report.manager else None
    return ReportRead(
        id=report.id,
        department_id=report.department_id,
        company_id=report.company_id,
        manager_name=manager_name,
        version=report.version,
        assessment=report.assessment,
        behavioral_patterns=report.behavioral_patterns,
        recommended_interventions=report.recommended_interventions,
        flagged_employee_count=report.flagged_employee_count,
        department_summary=report.department_summary,
        flagged_employees_data=report.flagged_employees_data,
        status=report.status,
        submitted_at=report.submitted_at,
        created_at=report.created_at,
    )


@router.get("/preview", response_model=ReportPreview)
def get_report_preview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> ReportPreview:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    summary, flagged = _build_preview(db, manager.department_id, manager.company_id)
    next_version = (
        db.query(Report)
        .filter(Report.department_id == manager.department_id)
        .count()
    ) + 1
    return ReportPreview(
        department_id=manager.department_id,
        company_id=manager.company_id,
        department_summary=summary,
        flagged_employees=flagged,
        next_version=next_version,
    )


@router.post("", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
def submit_report(
    payload: ReportSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> ReportRead:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    summary, flagged = _build_preview(db, manager.department_id, manager.company_id)
    next_version = (
        db.query(Report)
        .filter(Report.department_id == manager.department_id)
        .count()
    ) + 1

    report = Report(
        department_id=manager.department_id,
        company_id=manager.company_id,
        manager_user_id=current_user.id,
        version=next_version,
        assessment=payload.assessment,
        behavioral_patterns=payload.behavioral_patterns or None,
        recommended_interventions=payload.recommended_interventions or None,
        flagged_employee_count=len(flagged),
        department_summary=summary.model_dump(),
        flagged_employees_data=[e.model_dump() for e in flagged],
        status="submitted",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return _serialize_report(report)


@router.get("", response_model=ReportListResponse)
def list_reports(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER, UserRole.COMPANY_HEAD)),
) -> ReportListResponse:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    query = (
        db.query(Report)
        .filter(Report.department_id == manager.department_id)
        .order_by(Report.submitted_at.desc())
    )
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return ReportListResponse(items=[_serialize_report(r) for r in items], total=total)


@router.get("/{report_id}", response_model=ReportRead)
def get_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER, UserRole.COMPANY_HEAD)),
) -> ReportRead:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    report = (
        db.query(Report)
        .filter(Report.id == report_id, Report.department_id == manager.department_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return _serialize_report(report)
