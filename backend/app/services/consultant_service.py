import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.check_in_session import CheckInSession
from app.models.consultant import Consultant
from app.models.consultation_message import ConsultationMessage
from app.models.consultation_thread import ConsultationThread
from app.models.employee import Employee
from app.models.user import User


_ALIAS_ADJECTIVES = [
    "Quiet", "Calm", "Gentle", "Steady", "Warm", "Clear", "Bright", "Soft",
    "Kind", "Open", "Brave", "Still", "Wise", "Safe", "Easy",
]
_ALIAS_NOUNS = [
    "Horizon", "River", "Meadow", "Harbor", "Cedar", "Willow", "Stone",
    "Lantern", "Garden", "Compass", "Anchor", "Ember", "Dawn", "Shore", "Forest",
]


def _generate_alias(thread_id: int) -> str:
    random.seed(thread_id * 7919)
    adj = random.choice(_ALIAS_ADJECTIVES)
    noun = random.choice(_ALIAS_NOUNS)
    num = random.randint(10, 99)
    return f"{adj} {noun} {num}"


def get_consultant_profile_for_user_or_none(db: Session, user: User) -> Consultant | None:
    return db.scalar(select(Consultant).where(Consultant.user_id == user.id))


def get_employee_sad_session_count(db: Session, employee_id: int) -> int:
    sessions = (
        db.query(CheckInSession)
        .filter(
            CheckInSession.employee_id == employee_id,
            CheckInSession.status == "completed",
        )
        .order_by(CheckInSession.created_at.desc())
        .limit(5)
        .all()
    )
    count = 0
    for session in sessions:
        emotions = session.facial_emotions or {}
        dominant = emotions.get("dominant_label", "")
        if dominant == "sad":
            count += 1
        else:
            break
    return count


def get_company_consultants_active(db: Session, company_id: int) -> list[Consultant]:
    return db.scalars(
        select(Consultant)
        .options(selectinload(Consultant.user))
        .where(Consultant.company_id == company_id, Consultant.is_active == True)  # noqa: E712
    ).all()


def cleanup_old_messages(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(weeks=2)
    result = db.execute(
        ConsultationMessage.__table__.delete().where(ConsultationMessage.created_at < cutoff)
    )
    db.commit()
    return result.rowcount


def get_available_consultants_for_employee(db: Session, employee_user: User) -> list[Consultant]:
    from fastapi import HTTPException, status as http_status
    employee = db.scalar(select(Employee).where(Employee.user_id == employee_user.id))
    if not employee:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Employee profile not found")
    return get_company_consultants_active(db, employee.company_id)


def get_or_create_employee_thread(db: Session, employee_user: User, consultant_user_id: int | None = None) -> ConsultationThread:
    employee = db.scalar(select(Employee).where(Employee.user_id == employee_user.id))
    if not employee:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Employee profile not found")

    existing = db.scalar(
        select(ConsultationThread)
        .where(
            ConsultationThread.employee_user_id == employee_user.id,
            ConsultationThread.status.in_(["open", "assigned", "active"]),
        )
        .order_by(ConsultationThread.created_at.desc())
    )
    if existing:
        return existing

    if consultant_user_id is not None:
        valid = db.scalar(
            select(Consultant).where(
                Consultant.user_id == consultant_user_id,
                Consultant.company_id == employee.company_id,
                Consultant.is_active == True,  # noqa: E712
            )
        )
        if not valid:
            from fastapi import HTTPException, status as http_status
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Consultant not found or not active in your company",
            )

    thread = ConsultationThread(
        company_id=employee.company_id,
        employee_user_id=employee_user.id,
        consultant_user_id=consultant_user_id,
        anonymous_alias="pending",
        status="open" if not consultant_user_id else "assigned",
    )
    db.add(thread)
    db.flush()

    thread.anonymous_alias = _generate_alias(thread.id)
    db.flush()
    return thread


def list_consultant_threads(db: Session, consultant_user: User) -> list[ConsultationThread]:
    consultant = get_consultant_profile_for_user_or_none(db, consultant_user)
    if not consultant:
        return []
    threads = db.scalars(
        select(ConsultationThread)
        .options(selectinload(ConsultationThread.messages))
        .where(ConsultationThread.company_id == consultant.company_id)
        .order_by(ConsultationThread.updated_at.desc())
    ).all()
    return list(threads)


def get_thread_for_consultant(db: Session, thread_id: int, consultant_user: User) -> ConsultationThread | None:
    consultant = get_consultant_profile_for_user_or_none(db, consultant_user)
    if not consultant:
        return None
    return db.scalar(
        select(ConsultationThread)
        .options(selectinload(ConsultationThread.messages))
        .where(ConsultationThread.id == thread_id, ConsultationThread.company_id == consultant.company_id)
    )


def get_thread_for_employee(db: Session, thread_id: int, employee_user: User) -> ConsultationThread | None:
    return db.scalar(
        select(ConsultationThread)
        .options(selectinload(ConsultationThread.messages))
        .where(ConsultationThread.id == thread_id, ConsultationThread.employee_user_id == employee_user.id)
    )


def add_message(db: Session, thread: ConsultationThread, sender_user: User, sender_role: str, body: str) -> ConsultationMessage:
    if thread.status == "open" and sender_role == "consultant":
        thread.status = "active"
    elif thread.status in ("open", "assigned") and sender_role == "employee":
        thread.status = "active"

    msg = ConsultationMessage(
        thread_id=thread.id,
        sender_role=sender_role,
        sender_user_id=sender_user.id,
        message_body=body.strip(),
    )
    db.add(msg)
    db.flush()
    return msg


def get_advised_employee_count(db: Session, company_id: int) -> int:
    employees = db.scalars(
        select(Employee).where(Employee.company_id == company_id)
    ).all()
    count = 0
    for emp in employees:
        if get_employee_sad_session_count(db, emp.id) >= 2:
            count += 1
    return count
