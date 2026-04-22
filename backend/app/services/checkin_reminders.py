from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.check_in_reminder_log import CheckInReminderLog
from app.models.check_in_session import CheckInSession
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.user import User
from app.services.email import build_checkin_reminder_email_html, send_email

logger = logging.getLogger(__name__)

REMINDER_TYPE_NEXT_SESSION = "next_session_1day"


def _normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _latest_completed_session_rows(db: Session) -> list[tuple[int, str, str, datetime | None]]:
    event_time = func.coalesce(CheckInSession.completed_at, CheckInSession.created_at)

    rows = db.execute(
        select(
            Employee.id,
            User.full_name,
            User.email,
            func.max(event_time).label("last_session_at"),
        )
        .join(Employee.user)
        .outerjoin(
            CheckInSession,
            and_(
                CheckInSession.employee_id == Employee.id,
                CheckInSession.status == "completed",
            ),
        )
        .where(
            User.role == UserRole.EMPLOYEE,
            User.is_active.is_(True),
        )
        .group_by(Employee.id, User.full_name, User.email)
    ).all()

    return [
        (int(employee_id), full_name, email, _normalize_dt(last_session_at))
        for employee_id, full_name, email, last_session_at in rows
    ]


def run_due_checkin_reminders(db: Session, reference_time: datetime | None = None) -> int:
    """
    Send 1-day-before check-in reminder emails to employees.

    Reminders are deduplicated via check_in_reminder_logs unique constraint.
    """
    if not settings.checkin_reminders_enabled:
        return 0

    now = reference_time or datetime.now(timezone.utc)
    today = now.date()
    sent_count = 0

    for employee_id, full_name, email, last_session_at in _latest_completed_session_rows(db):
        if not email or last_session_at is None:
            continue

        next_session_at = last_session_at + timedelta(days=settings.checkin_reminder_interval_days)
        reminder_date = (next_session_at - timedelta(days=settings.checkin_reminder_lead_days)).date()
        if today != reminder_date:
            continue

        days_since_last_checkin = max(0, (today - last_session_at.date()).days)
        reminder_log = CheckInReminderLog(
            employee_id=employee_id,
            reminder_type=REMINDER_TYPE_NEXT_SESSION,
            reminder_for_date=reminder_date,
            next_session_date=next_session_at.date(),
            days_since_last_checkin=days_since_last_checkin,
        )

        try:
            with db.begin_nested():
                db.add(reminder_log)
                db.flush()

                html = build_checkin_reminder_email_html(
                    full_name=full_name,
                    days_since_last_checkin=days_since_last_checkin,
                    next_session_date=next_session_at.date().isoformat(),
                )
                send_email(
                    to_email=email,
                    subject="MindWell Reminder: Your next check-in is tomorrow",
                    html_body=html,
                    text_body=(
                        f"Hello {full_name},\n\n"
                        "This is your MindWell check-in reminder.\n"
                        f"It has been {days_since_last_checkin} day(s) since your last completed session.\n"
                        f"Recommended next session date: {next_session_at.date().isoformat()}\n\n"
                        "Open your Employee Dashboard to complete your next check-in."
                    ),
                )
            sent_count += 1
        except IntegrityError:
            # Already sent for this employee/date/type.
            continue
        except Exception as exc:
            logger.warning("Failed to send check-in reminder to %s: %s", email, exc)
            continue

    return sent_count
