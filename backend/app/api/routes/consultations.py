from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.check_in_session import CheckInSession
from app.models.company import Company
from app.models.consultation_team_config import ConsultationTeamConfig
from app.models.counselor_consultation_request import CounselorConsultationRequest
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.common import PaginationMeta
from app.schemas.consultation import (
    ConsultationQueueItemRead,
    ConsultationQueueListResponse,
    ConsultationRequestCreate,
    ConsultationRequestRead,
    ConsultationRequestSchedule,
    ConsultationTeamConfigRead,
    ConsultationTeamConfigUpdate,
)
from app.services.privacy_crypto import decrypt_text, encrypt_text
from app.services.questionnaire.session_service import get_employee_for_user

router = APIRouter(prefix="/consultations", tags=["Consultations"])

ELIGIBLE_TIERS = {"high", "severe"}


def _employee_or_404(db: Session, user: User) -> Employee:
    employee = get_employee_for_user(db, user.id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
    return employee


def _serialize_config(config: ConsultationTeamConfig, company_id: int) -> ConsultationTeamConfigRead:
    return ConsultationTeamConfigRead(
        company_id=company_id,
        is_enabled=bool(config.is_enabled),
        provider_name=config.provider_name,
        contact_email=config.contact_email,
        guidance_note=config.guidance_note,
        updated_at=config.updated_at,
    )


def _get_or_create_company_config(db: Session, company_id: int) -> ConsultationTeamConfig:
    config = db.scalar(select(ConsultationTeamConfig).where(ConsultationTeamConfig.company_id == company_id))
    if config is None:
        config = ConsultationTeamConfig(company_id=company_id, is_enabled=False)
        db.add(config)
        db.flush()
    return config


def _serialize_request(item: CounselorConsultationRequest) -> ConsultationRequestRead:
    return ConsultationRequestRead(
        id=item.id,
        company_id=item.company_id,
        employee_id=item.employee_id,
        source_session_id=item.source_session_id,
        threshold_tier=item.threshold_tier,
        status=item.status,
        note=decrypt_text(item.request_note_encrypted),
        scheduler_note=decrypt_text(item.scheduler_note_encrypted),
        scheduled_for=item.scheduled_for,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _serialize_queue_item(item: CounselorConsultationRequest) -> ConsultationQueueItemRead:
    employee_name = item.employee.user.full_name if item.employee and item.employee.user else f"Employee {item.employee_id}"
    employee_email = item.employee.user.email if item.employee and item.employee.user else "-"
    return ConsultationQueueItemRead(
        id=item.id,
        company_id=item.company_id,
        employee_id=item.employee_id,
        source_session_id=item.source_session_id,
        employee_name=employee_name,
        employee_email=employee_email,
        threshold_tier=item.threshold_tier,
        status=item.status,
        note=decrypt_text(item.request_note_encrypted),
        scheduler_note=decrypt_text(item.scheduler_note_encrypted),
        scheduled_for=item.scheduled_for,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _eligible_session_for_request(
    db: Session,
    *,
    employee_id: int,
    session_id: int | None,
) -> CheckInSession:
    query = select(CheckInSession).where(
        CheckInSession.employee_id == employee_id,
        CheckInSession.status == "completed",
    )
    if session_id is not None:
        query = query.where(CheckInSession.id == session_id)
    query = query.order_by(CheckInSession.completed_at.desc().nullslast(), CheckInSession.created_at.desc())

    session = db.scalar(query)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No completed check-in session found for consultation request.",
        )
    if (session.threshold_tier or "").lower() not in ELIGIBLE_TIERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Consultation requests are available only for High or Severe check-ins.",
        )
    return session


@router.get("/team-config", response_model=ConsultationTeamConfigRead)
def get_team_config_for_employee(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> ConsultationTeamConfigRead:
    employee = _employee_or_404(db, current_user)
    config = _get_or_create_company_config(db, employee.company_id)
    db.commit()
    return _serialize_config(config, employee.company_id)


@router.get("/team-config/{company_id}", response_model=ConsultationTeamConfigRead)
def get_team_config_for_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> ConsultationTeamConfigRead:
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.")
    config = _get_or_create_company_config(db, company_id)
    db.commit()
    return _serialize_config(config, company_id)


@router.put("/team-config/{company_id}", response_model=ConsultationTeamConfigRead)
def update_team_config(
    company_id: int,
    payload: ConsultationTeamConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> ConsultationTeamConfigRead:
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.")

    config = _get_or_create_company_config(db, company_id)
    config.is_enabled = payload.is_enabled
    config.provider_name = payload.provider_name
    config.contact_email = payload.contact_email
    config.guidance_note = payload.guidance_note
    if config.created_by_user_id is None:
        config.created_by_user_id = current_user.id
    config.updated_by_user_id = current_user.id
    db.commit()
    db.refresh(config)
    return _serialize_config(config, company_id)


@router.post("/request", response_model=ConsultationRequestRead, status_code=status.HTTP_201_CREATED)
def create_consultation_request(
    payload: ConsultationRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> ConsultationRequestRead:
    employee = _employee_or_404(db, current_user)
    config = _get_or_create_company_config(db, employee.company_id)
    if not config.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Consultation is not enabled for your company.",
        )

    session = _eligible_session_for_request(db, employee_id=employee.id, session_id=payload.session_id)

    existing_request = db.scalar(
        select(CounselorConsultationRequest).where(
            CounselorConsultationRequest.employee_id == employee.id,
            CounselorConsultationRequest.source_session_id == session.id,
            CounselorConsultationRequest.status.in_(("pending", "scheduled")),
        )
    )
    if existing_request is not None:
        return _serialize_request(existing_request)

    request_entry = CounselorConsultationRequest(
        company_id=employee.company_id,
        employee_id=employee.id,
        source_session_id=session.id,
        threshold_tier=(session.threshold_tier or "").lower(),
        request_note_encrypted=encrypt_text(payload.note or ""),
        status="pending",
    )
    db.add(request_entry)
    db.commit()
    db.refresh(request_entry)
    return _serialize_request(request_entry)


@router.get("/my", response_model=list[ConsultationRequestRead])
def list_my_consultation_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> list[ConsultationRequestRead]:
    employee = _employee_or_404(db, current_user)
    items = db.scalars(
        select(CounselorConsultationRequest)
        .where(CounselorConsultationRequest.employee_id == employee.id)
        .order_by(CounselorConsultationRequest.created_at.desc())
    ).all()
    return [_serialize_request(item) for item in items]


@router.get("/queue", response_model=ConsultationQueueListResponse)
def list_consultation_queue(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    company_id: int | None = Query(default=None, ge=1),
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> ConsultationQueueListResponse:
    query = (
        select(CounselorConsultationRequest)
        .options(joinedload(CounselorConsultationRequest.employee).joinedload(Employee.user))
        .order_by(CounselorConsultationRequest.created_at.desc())
    )
    total_query = select(func.count(CounselorConsultationRequest.id))

    if company_id is not None:
        query = query.where(CounselorConsultationRequest.company_id == company_id)
        total_query = total_query.where(CounselorConsultationRequest.company_id == company_id)

    if status_filter:
        status_value = status_filter.strip().lower()
        query = query.where(CounselorConsultationRequest.status == status_value)
        total_query = total_query.where(CounselorConsultationRequest.status == status_value)

    total = db.scalar(total_query) or 0
    items = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return ConsultationQueueListResponse(
        items=[_serialize_queue_item(item) for item in items],
        meta=PaginationMeta.create(page=page, page_size=page_size, total=total),
    )


@router.put("/queue/{request_id}/schedule", response_model=ConsultationQueueItemRead)
def schedule_consultation_request(
    request_id: int,
    payload: ConsultationRequestSchedule,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
) -> ConsultationQueueItemRead:
    item = db.scalar(
        select(CounselorConsultationRequest)
        .where(CounselorConsultationRequest.id == request_id)
        .options(joinedload(CounselorConsultationRequest.employee).joinedload(Employee.user))
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consultation request not found.")

    item.scheduled_for = payload.scheduled_for
    item.scheduler_note_encrypted = encrypt_text(payload.scheduler_note or "")
    item.scheduled_by_user_id = current_user.id
    item.status = "scheduled"
    db.commit()
    db.refresh(item)
    return _serialize_queue_item(item)
