from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.consultation_chat import (
    ConsultationThreadDetail,
    ConsultationThreadRead,
    SendMessageRequest,
    StartConsultationResponse,
    ThreadMessageRead,
    UpdateThreadStatusRequest,
)
from app.services.consultant_service import (
    add_message,
    get_or_create_employee_thread,
    get_thread_for_consultant,
    get_thread_for_employee,
    list_consultant_threads,
)

router = APIRouter(prefix="/consultation-chat", tags=["Consultation Chat"])


def _serialize_thread(thread) -> ConsultationThreadRead:
    msgs = thread.messages or []
    last_at = max((m.created_at for m in msgs), default=None) if msgs else None
    return ConsultationThreadRead(
        id=thread.id,
        anonymous_alias=thread.anonymous_alias,
        status=thread.status,
        message_count=len(msgs),
        last_message_at=last_at,
        created_at=thread.created_at,
    )


def _serialize_detail(thread) -> ConsultationThreadDetail:
    msgs = sorted(thread.messages or [], key=lambda m: m.created_at)
    return ConsultationThreadDetail(
        id=thread.id,
        anonymous_alias=thread.anonymous_alias,
        status=thread.status,
        created_at=thread.created_at,
        messages=[
            ThreadMessageRead(
                id=m.id,
                sender_role=m.sender_role,
                message_body=m.message_body,
                created_at=m.created_at,
            )
            for m in msgs
        ],
    )


# ---------- Employee endpoints ----------

@router.post("/start", response_model=StartConsultationResponse)
def start_consultation(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> StartConsultationResponse:
    thread = get_or_create_employee_thread(db, current_user)
    db.commit()
    db.refresh(thread)
    return StartConsultationResponse(
        thread_id=thread.id,
        anonymous_alias=thread.anonymous_alias,
        status=thread.status,
    )


@router.get("/my-thread", response_model=ConsultationThreadDetail)
def get_my_thread(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> ConsultationThreadDetail:
    from sqlalchemy import select
    from app.models.consultation_thread import ConsultationThread
    from sqlalchemy.orm import selectinload

    thread = db.scalar(
        select(ConsultationThread)
        .options(selectinload(ConsultationThread.messages))
        .where(
            ConsultationThread.employee_user_id == current_user.id,
            ConsultationThread.status.notin_(["resolved", "closed"]),
        )
        .order_by(ConsultationThread.created_at.desc())
    )
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active consultation thread")
    return _serialize_detail(thread)


@router.post("/my-thread/send", response_model=ThreadMessageRead)
def employee_send_message(
    payload: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> ThreadMessageRead:
    from sqlalchemy import select
    from app.models.consultation_thread import ConsultationThread
    from sqlalchemy.orm import selectinload

    thread = db.scalar(
        select(ConsultationThread)
        .options(selectinload(ConsultationThread.messages))
        .where(
            ConsultationThread.employee_user_id == current_user.id,
            ConsultationThread.status.notin_(["resolved", "closed"]),
        )
        .order_by(ConsultationThread.created_at.desc())
    )
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active consultation thread. Start one first.")
    if not payload.message_body.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty")
    msg = add_message(db, thread, current_user, "employee", payload.message_body)
    db.commit()
    db.refresh(msg)
    return ThreadMessageRead(id=msg.id, sender_role=msg.sender_role, message_body=msg.message_body, created_at=msg.created_at)


# ---------- Consultant endpoints ----------

@router.get("/threads", response_model=list[ConsultationThreadRead])
def list_threads(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> list[ConsultationThreadRead]:
    threads = list_consultant_threads(db, current_user)
    return [_serialize_thread(t) for t in threads]


@router.get("/threads/{thread_id}", response_model=ConsultationThreadDetail)
def get_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> ConsultationThreadDetail:
    thread = get_thread_for_consultant(db, thread_id, current_user)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    return _serialize_detail(thread)


@router.post("/threads/{thread_id}/send", response_model=ThreadMessageRead)
def consultant_send_message(
    thread_id: int,
    payload: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> ThreadMessageRead:
    thread = get_thread_for_consultant(db, thread_id, current_user)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    if not payload.message_body.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty")
    msg = add_message(db, thread, current_user, "consultant", payload.message_body)
    db.commit()
    db.refresh(msg)
    return ThreadMessageRead(id=msg.id, sender_role=msg.sender_role, message_body=msg.message_body, created_at=msg.created_at)


@router.patch("/threads/{thread_id}/status", response_model=ConsultationThreadRead)
def update_thread_status(
    thread_id: int,
    payload: UpdateThreadStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CONSULTANT)),
) -> ConsultationThreadRead:
    allowed_statuses = {"active", "resolved", "closed"}
    if payload.status not in allowed_statuses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Status must be one of: {allowed_statuses}")
    thread = get_thread_for_consultant(db, thread_id, current_user)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    thread.status = payload.status
    db.commit()
    db.refresh(thread)
    return _serialize_thread(thread)
