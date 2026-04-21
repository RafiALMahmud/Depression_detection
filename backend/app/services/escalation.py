"""Escalation alert detection and delivery for Department Managers.

Implements three conditions (Module 2 / FR 4):
  A. Any employee hits "severe" in two consecutive completed sessions.
  B. Department average composite score crosses into Moderate tier (>25)
     for two consecutive calendar weeks (Mon 00:00 UTC – Sun 23:59 UTC).
  C. More than 20% of the department's employees are non_compliant this week.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.check_in_session import CheckInSession
from app.models.department_manager import DepartmentManager
from app.models.employee import Employee
from app.models.escalation_alert import EscalationAlert
from app.models.user import User
from app.services.email import send_email

logger = logging.getLogger(__name__)

SEVERE_TIER = "severe"
MODERATE_BOUNDARY = 25.0
NON_COMPLIANCE_THRESHOLD = 0.20


# ---------------------------------------------------------------------------
# Week helpers
# ---------------------------------------------------------------------------

def _this_week_start_utc() -> datetime:
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    return datetime(monday.year, monday.month, monday.day, tzinfo=timezone.utc)


def _last_week_start_utc() -> datetime:
    return _this_week_start_utc() - timedelta(weeks=1)


def _week_label(week_start: datetime) -> str:
    week_end = week_start + timedelta(days=6)
    return f"{week_start.date().isoformat()} – {week_end.date().isoformat()}"


# ---------------------------------------------------------------------------
# Condition detection
# ---------------------------------------------------------------------------

def check_condition_a(db: Session, employee_id: int) -> dict[str, Any] | None:
    """Return detail dict if last 2 completed sessions are both severe, else None."""
    last_two = (
        db.query(CheckInSession)
        .filter(
            CheckInSession.employee_id == employee_id,
            CheckInSession.status == "completed",
        )
        .order_by(CheckInSession.completed_at.desc().nullslast(), CheckInSession.created_at.desc())
        .limit(2)
        .all()
    )
    if len(last_two) < 2:
        return None
    if not all(s.threshold_tier == SEVERE_TIER for s in last_two):
        return None

    employee = db.get(Employee, employee_id)
    employee_name = employee.user.full_name if employee and employee.user else f"Employee #{employee_id}"

    return {
        "employee_id": employee_id,
        "employee_name": employee_name,
        "session_ids": [s.id for s in last_two],
        "scores": [s.composite_score for s in last_two],
        "session_dates": [
            (s.completed_at or s.created_at).isoformat() if (s.completed_at or s.created_at) else None
            for s in last_two
        ],
    }


def _weekly_avg_composite(db: Session, department_id: int, week_start: datetime) -> float | None:
    week_end = week_start + timedelta(weeks=1)
    avg = (
        db.query(func.avg(CheckInSession.composite_score))
        .join(Employee, Employee.id == CheckInSession.employee_id)
        .filter(
            Employee.department_id == department_id,
            CheckInSession.status == "completed",
            CheckInSession.composite_score.isnot(None),
            CheckInSession.created_at >= week_start,
            CheckInSession.created_at < week_end,
        )
        .scalar()
    )
    return float(avg) if avg is not None else None


def check_condition_b(db: Session, department_id: int) -> dict[str, Any] | None:
    """Return detail dict if dept avg crossed Moderate for 2 consecutive weeks."""
    this_start = _this_week_start_utc()
    last_start = _last_week_start_utc()

    this_avg = _weekly_avg_composite(db, department_id, this_start)
    last_avg = _weekly_avg_composite(db, department_id, last_start)

    if this_avg is None or last_avg is None:
        return None
    if this_avg <= MODERATE_BOUNDARY or last_avg <= MODERATE_BOUNDARY:
        return None

    return {
        "week1_label": _week_label(last_start),
        "week1_avg": round(last_avg, 2),
        "week2_label": _week_label(this_start),
        "week2_avg": round(this_avg, 2),
        "moderate_boundary": MODERATE_BOUNDARY,
    }


def check_condition_c(db: Session, department_id: int) -> dict[str, Any] | None:
    """Return detail dict if >20% of dept employees are non_compliant this week."""
    employees = db.query(Employee).filter(Employee.department_id == department_id).all()
    total = len(employees)
    if total == 0:
        return None

    non_compliant = sum(1 for e in employees if e.compliance_status == "non_compliant")
    percentage = non_compliant / total
    if percentage <= NON_COMPLIANCE_THRESHOLD:
        return None

    return {
        "non_compliant_count": non_compliant,
        "total_employees": total,
        "percentage": round(percentage * 100, 1),
        "week_label": _week_label(_this_week_start_utc()),
        "threshold_percentage": round(NON_COMPLIANCE_THRESHOLD * 100, 1),
    }


# ---------------------------------------------------------------------------
# Alert creation & email
# ---------------------------------------------------------------------------

def _manager_for_department(db: Session, department_id: int) -> tuple[DepartmentManager | None, User | None]:
    profile = (
        db.query(DepartmentManager)
        .filter(DepartmentManager.department_id == department_id)
        .first()
    )
    if not profile:
        return None, None
    return profile, profile.user


def _existing_unacknowledged(
    db: Session, department_id: int, condition_type: str
) -> EscalationAlert | None:
    return (
        db.query(EscalationAlert)
        .filter(
            EscalationAlert.department_id == department_id,
            EscalationAlert.condition_type == condition_type,
            EscalationAlert.is_acknowledged.is_(False),
        )
        .first()
    )


def _condition_subject(condition_type: str) -> str:
    return {
        "A": "MindWell Alert: Consecutive Severe Scores - Action Required",
        "B": "MindWell Alert: Department Average Elevated for Two Weeks",
        "C": "MindWell Alert: High Non-Compliance Rate in Your Department",
    }.get(condition_type, "MindWell Alert")


def _condition_title(condition_type: str) -> str:
    return {
        "A": "Consecutive Severe Sessions",
        "B": "Department Average Elevated",
        "C": "High Non-Compliance",
    }.get(condition_type, "Escalation Alert")


def _build_email_html(
    *,
    manager_name: str,
    condition_type: str,
    details: dict[str, Any],
) -> str:
    title = _condition_title(condition_type)
    if condition_type == "A":
        body = (
            f"<p>Employee <strong>{details.get('employee_name')}</strong> has scored "
            f"<strong>Severe</strong> in two consecutive check-in sessions.</p>"
            f"<p>Composite scores: {', '.join(str(s) for s in details.get('scores', []))}.</p>"
        )
    elif condition_type == "B":
        body = (
            f"<p>Your department's average composite score has exceeded the Moderate "
            f"threshold ({details.get('moderate_boundary')}) for two consecutive weeks.</p>"
            f"<ul>"
            f"<li>Week 1 ({details.get('week1_label')}): {details.get('week1_avg')}</li>"
            f"<li>Week 2 ({details.get('week2_label')}): {details.get('week2_avg')}</li>"
            f"</ul>"
        )
    else:
        body = (
            f"<p>{details.get('percentage')}% of your department's employees are "
            f"currently marked non-compliant "
            f"({details.get('non_compliant_count')} of {details.get('total_employees')}).</p>"
            f"<p>Week: {details.get('week_label')}</p>"
        )

    return f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf8f3;font-family:'DM Sans',Arial,sans-serif;color:#1a2b3c;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f3;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:18px;border:1px solid rgba(26,43,60,0.08);overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#8b1e1e,#b33333);padding:26px 30px;">
                <div style="font-family:'DM Serif Display',Georgia,serif;font-size:28px;line-height:1;color:#ffffff;letter-spacing:-0.4px;">
                  MindWell Escalation Alert
                </div>
                <p style="margin:10px 0 0;color:rgba(255,255,255,0.82);font-size:13px;">{title}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <p style="margin:0 0 14px;font-size:15px;">Hello {manager_name},</p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#3a4a5a;">
                  An automated escalation alert has been triggered for your department.
                </p>
                <div style="margin:0 0 18px;padding:16px 18px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;color:#7f1d1d;font-size:14px;line-height:1.6;">
                  {body}
                </div>
                <p style="margin:0 0 18px;font-size:14px;color:#3a4a5a;">
                  Please log in to MindWell to review the full details and acknowledge this alert.
                  Alerts remain on your dashboard until explicitly acknowledged.
                </p>
                <p style="margin:0;">
                  <a href="{settings.frontend_base_url}" style="display:inline-block;background:#1a2b3c;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 24px;font-weight:600;font-size:14px;">
                    Open MindWell Dashboard
                  </a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 30px;border-top:1px solid rgba(26,43,60,0.08);background:#faf8f3;">
                <p style="margin:0;font-size:11px;color:#5a6a7a;">
                  MindWell - Automated Escalation Alerts
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _try_send_email(alert: EscalationAlert, manager_user: User) -> bool:
    try:
        html = _build_email_html(
            manager_name=manager_user.full_name,
            condition_type=alert.condition_type,
            details=alert.details or {},
        )
        send_email(
            to_email=manager_user.email,
            subject=_condition_subject(alert.condition_type),
            html_body=html,
        )
        return True
    except Exception as exc:  # Never block session completion on email errors
        logger.warning("Failed to send escalation alert email for alert %s: %s", alert.id, exc)
        return False


def _create_alert(
    db: Session,
    *,
    department_id: int,
    company_id: int,
    condition_type: str,
    details: dict[str, Any],
    manager_user: User | None,
) -> EscalationAlert | None:
    if _existing_unacknowledged(db, department_id, condition_type) is not None:
        return None

    alert = EscalationAlert(
        department_id=department_id,
        company_id=company_id,
        manager_user_id=manager_user.id if manager_user else None,
        condition_type=condition_type,
        details=details,
        is_acknowledged=False,
        email_sent=False,
    )
    db.add(alert)
    db.flush()

    if manager_user and manager_user.email:
        if _try_send_email(alert, manager_user):
            alert.email_sent = True

    return alert


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_escalation_checks_for_session(db: Session, session: CheckInSession) -> None:
    """Run all three escalation checks after a session is completed.

    Safe to call on every completion: duplicate alerts are suppressed while any
    unacknowledged alert of the same condition already exists.
    """
    employee = db.get(Employee, session.employee_id)
    if employee is None:
        return

    department_id = employee.department_id
    company_id = employee.company_id
    _, manager_user = _manager_for_department(db, department_id)

    # Condition A — per-employee
    detail_a = check_condition_a(db, session.employee_id)
    if detail_a is not None:
        _create_alert(
            db,
            department_id=department_id,
            company_id=company_id,
            condition_type="A",
            details=detail_a,
            manager_user=manager_user,
        )

    # Condition B — department two-week average
    detail_b = check_condition_b(db, department_id)
    if detail_b is not None:
        _create_alert(
            db,
            department_id=department_id,
            company_id=company_id,
            condition_type="B",
            details=detail_b,
            manager_user=manager_user,
        )

    # Condition C — non-compliance ratio
    detail_c = check_condition_c(db, department_id)
    if detail_c is not None:
        _create_alert(
            db,
            department_id=department_id,
            company_id=company_id,
            condition_type="C",
            details=detail_c,
            manager_user=manager_user,
        )
