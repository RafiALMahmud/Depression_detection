from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.core.config import settings
from app.db.session import get_db
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.peer_support_reaction import PeerSupportReaction
from app.models.peer_support_reply import PeerSupportReply
from app.models.peer_support_thread import PeerSupportThread
from app.models.user import User
from app.schemas.common import PaginationMeta
from app.schemas.peer_support import (
    PeerSupportReactionCount,
    PeerSupportReactionUpdate,
    PeerSupportReplyCreate,
    PeerSupportReplyRead,
    PeerSupportThreadCreate,
    PeerSupportThreadListResponse,
    PeerSupportThreadRead,
)
from app.services.content_moderation import moderate_text
from app.services.hierarchy import get_department_manager_profile_for_user_or_403
from app.services.privacy_crypto import decrypt_text, encrypt_text
from app.services.questionnaire.session_service import get_employee_for_user

router = APIRouter(prefix="/peer-support", tags=["Peer Support"])

REACTION_TYPES = ("you_are_not_alone", "sending_support", "take_a_breath", "stay_strong")


class _CommunityScope:
    def __init__(self, *, user_id: int, role: UserRole, company_id: int, department_id: int | None):
        self.user_id = user_id
        self.role = role
        self.company_id = company_id
        self.department_id = department_id


def _employee_or_404(db: Session, current_user: User) -> Employee:
    employee = get_employee_for_user(db, current_user.id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
    return employee


def _build_scope_or_403(db: Session, current_user: User) -> _CommunityScope:
    if current_user.role == UserRole.EMPLOYEE:
        employee = _employee_or_404(db, current_user)
        return _CommunityScope(
            user_id=current_user.id,
            role=current_user.role,
            company_id=employee.company_id,
            department_id=employee.department_id,
        )

    if current_user.role == UserRole.DEPARTMENT_MANAGER:
        profile = get_department_manager_profile_for_user_or_403(db, current_user)
        return _CommunityScope(
            user_id=current_user.id,
            role=current_user.role,
            company_id=profile.company_id,
            department_id=profile.department_id,
        )

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


def _thread_author_employee(db: Session, author_user_id: int) -> Employee | None:
    return db.scalar(select(Employee).where(Employee.user_id == author_user_id))


def _can_delete_thread(db: Session, thread: PeerSupportThread, scope: _CommunityScope) -> bool:
    if scope.role == UserRole.EMPLOYEE:
        return thread.author_user_id == scope.user_id

    if scope.role == UserRole.DEPARTMENT_MANAGER:
        author_employee = _thread_author_employee(db, thread.author_user_id)
        if author_employee is None:
            return False
        return (
            author_employee.company_id == scope.company_id
            and scope.department_id is not None
            and author_employee.department_id == scope.department_id
        )

    return False


def _anonymous_alias(company_id: int, user_id: int) -> str:
    payload = f"{settings.jwt_secret_key}:{company_id}:{user_id}".encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    colleague_number = int(digest[:8], 16) % 900 + 100
    return f"Colleague #{colleague_number}"


def _serialize_reply(reply: PeerSupportReply, company_id: int, include_removed: bool = False) -> PeerSupportReplyRead | None:
    if reply.moderation_status != "approved" and not include_removed:
        return None

    content = (
        decrypt_text(reply.content_encrypted)
        if reply.moderation_status == "approved"
        else "This reply was removed by moderation."
    )
    return PeerSupportReplyRead(
        id=reply.id,
        alias=_anonymous_alias(company_id, reply.author_user_id),
        content=content,
        moderation_status=reply.moderation_status,
        moderation_reason=reply.moderation_reason,
        created_at=reply.created_at,
    )


def _serialize_thread(thread: PeerSupportThread, current_user_id: int, can_delete: bool, include_removed: bool = False) -> PeerSupportThreadRead:
    visible_replies = [
        serialized
        for reply in sorted(thread.replies, key=lambda item: item.created_at)
        if (serialized := _serialize_reply(reply, thread.company_id, include_removed=include_removed)) is not None
    ]

    counts = {reaction_type: 0 for reaction_type in REACTION_TYPES}
    my_reaction: str | None = None
    for reaction in thread.reactions:
        if reaction.reaction_type not in counts:
            continue
        counts[reaction.reaction_type] += 1
        if reaction.reactor_user_id == current_user_id:
            my_reaction = reaction.reaction_type

    if thread.moderation_status == "approved":
        content = decrypt_text(thread.content_encrypted)
    else:
        content = "This post was removed by moderation."

    return PeerSupportThreadRead(
        id=thread.id,
        alias=_anonymous_alias(thread.company_id, thread.author_user_id),
        content=content,
        created_at=thread.created_at,
        moderation_status=thread.moderation_status,
        moderation_reason=thread.moderation_reason,
        reply_count=len(visible_replies),
        can_delete=can_delete,
        reactions=[
            PeerSupportReactionCount(reaction_type=reaction_type, count=counts[reaction_type])
            for reaction_type in REACTION_TYPES
        ],
        my_reaction=my_reaction,  # type: ignore[arg-type]
        replies=visible_replies,
    )


def _thread_in_company_or_404(db: Session, thread_id: int, company_id: int) -> PeerSupportThread:
    thread = db.scalar(
        select(PeerSupportThread)
        .where(PeerSupportThread.id == thread_id, PeerSupportThread.company_id == company_id)
        .options(
            selectinload(PeerSupportThread.replies),
            selectinload(PeerSupportThread.reactions),
        )
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")
    return thread


@router.get("/threads", response_model=PeerSupportThreadListResponse)
def list_threads(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    all_threads: bool = Query(default=False, alias="all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE, UserRole.DEPARTMENT_MANAGER)),
) -> PeerSupportThreadListResponse:
    scope = _build_scope_or_403(db, current_user)

    base_query = select(PeerSupportThread).where(
        PeerSupportThread.company_id == scope.company_id,
        PeerSupportThread.moderation_status == "approved",
    )

    total_query = select(func.count(PeerSupportThread.id)).where(
        PeerSupportThread.company_id == scope.company_id,
        PeerSupportThread.moderation_status == "approved",
    )

    if scope.role == UserRole.DEPARTMENT_MANAGER:
        if scope.department_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department manager scope is not configured.")
        base_query = base_query.join(Employee, Employee.user_id == PeerSupportThread.author_user_id).where(
            Employee.department_id == scope.department_id
        )
        total_query = total_query.join(Employee, Employee.user_id == PeerSupportThread.author_user_id).where(
            Employee.department_id == scope.department_id
        )

    total = db.scalar(total_query) or 0

    thread_query = (
        base_query.options(
            selectinload(PeerSupportThread.replies),
            selectinload(PeerSupportThread.reactions),
        )
        .order_by(PeerSupportThread.created_at.desc())
    )

    if not all_threads:
        thread_query = thread_query.offset((page - 1) * page_size).limit(page_size)

    threads = db.scalars(thread_query).all()
    effective_page = 1 if all_threads else page
    effective_page_size = total if all_threads else page_size

    return PeerSupportThreadListResponse(
        items=[_serialize_thread(thread, current_user.id, can_delete=_can_delete_thread(db, thread, scope)) for thread in threads],
        meta=PaginationMeta.create(page=effective_page, page_size=max(1, effective_page_size), total=total),
    )


@router.post("/threads", response_model=PeerSupportThreadRead, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: PeerSupportThreadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> PeerSupportThreadRead:
    employee = _employee_or_404(db, current_user)
    if len(payload.content) > settings.peer_support_max_post_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Post is too long. Max {settings.peer_support_max_post_length} characters.",
        )

    moderation = moderate_text(payload.content)
    thread = PeerSupportThread(
        company_id=employee.company_id,
        author_user_id=current_user.id,
        content_encrypted=encrypt_text(payload.content),
        moderation_status=moderation.status,
        moderation_reason=moderation.reason,
        moderated_at=datetime.now(timezone.utc),
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return _serialize_thread(thread, current_user.id, can_delete=True, include_removed=True)


@router.get("/threads/{thread_id}", response_model=PeerSupportThreadRead)
def get_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE, UserRole.DEPARTMENT_MANAGER)),
) -> PeerSupportThreadRead:
    scope = _build_scope_or_403(db, current_user)
    thread = _thread_in_company_or_404(db, thread_id, scope.company_id)
    if scope.role == UserRole.DEPARTMENT_MANAGER and not _can_delete_thread(db, thread, scope):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")
    if thread.moderation_status != "approved" and thread.author_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")
    return _serialize_thread(
        thread,
        current_user.id,
        can_delete=_can_delete_thread(db, thread, scope),
        include_removed=thread.author_user_id == current_user.id,
    )


@router.post("/threads/{thread_id}/replies", response_model=PeerSupportReplyRead, status_code=status.HTTP_201_CREATED)
def create_reply(
    thread_id: int,
    payload: PeerSupportReplyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> PeerSupportReplyRead:
    employee = _employee_or_404(db, current_user)
    thread = _thread_in_company_or_404(db, thread_id, employee.company_id)
    if thread.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reply to a moderated thread.")

    if len(payload.content) > settings.peer_support_max_reply_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Reply is too long. Max {settings.peer_support_max_reply_length} characters.",
        )

    moderation = moderate_text(payload.content)
    reply = PeerSupportReply(
        thread_id=thread.id,
        author_user_id=current_user.id,
        content_encrypted=encrypt_text(payload.content),
        moderation_status=moderation.status,
        moderation_reason=moderation.reason,
        moderated_at=datetime.now(timezone.utc),
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)
    serialized = _serialize_reply(reply, employee.company_id, include_removed=True)
    if serialized is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Reply serialization failed.")
    return serialized


@router.put("/threads/{thread_id}/reaction", response_model=PeerSupportThreadRead)
def update_reaction(
    thread_id: int,
    payload: PeerSupportReactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> PeerSupportThreadRead:
    employee = _employee_or_404(db, current_user)
    thread = _thread_in_company_or_404(db, thread_id, employee.company_id)
    if thread.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot react to a moderated thread.")

    existing = db.scalar(
        select(PeerSupportReaction).where(
            PeerSupportReaction.thread_id == thread_id,
            PeerSupportReaction.reactor_user_id == current_user.id,
        )
    )
    if payload.reaction_type is None:
        if existing is not None:
            db.delete(existing)
    else:
        if existing is None:
            existing = PeerSupportReaction(
                thread_id=thread_id,
                reactor_user_id=current_user.id,
                reaction_type=payload.reaction_type,
            )
            db.add(existing)
        else:
            existing.reaction_type = payload.reaction_type

    db.commit()
    refreshed = _thread_in_company_or_404(db, thread_id, employee.company_id)
    return _serialize_thread(refreshed, current_user.id, can_delete=_can_delete_thread(db, refreshed, _build_scope_or_403(db, current_user)))


@router.delete("/threads/{thread_id}", status_code=status.HTTP_200_OK)
def delete_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE, UserRole.DEPARTMENT_MANAGER)),
) -> dict[str, str]:
    scope = _build_scope_or_403(db, current_user)
    thread = _thread_in_company_or_404(db, thread_id, scope.company_id)
    if not _can_delete_thread(db, thread, scope):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this thread.")

    db.delete(thread)
    db.commit()
    return {"message": "Thread deleted successfully."}
