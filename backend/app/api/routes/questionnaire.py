import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.questionnaire import (
    DepressionLogEntry,
    ScoringConfigRead,
    ScoringConfigUpdateRequest,
    SessionDetail,
    SessionListResponse,
    StartSessionRequest,
    StartSessionResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
    SymptomFrequencyItem,
    StreakInfo,
)
from app.services.questionnaire import session_service
from app.services.questionnaire.log_pdf import build_depression_log_pdf
from app.services.scoring_config import get_or_create_config, update_weights

router = APIRouter(prefix="/questionnaire", tags=["questionnaire"])


def _get_employee_or_404(db: Session, user: User):
    employee = session_service.get_employee_for_user(db, user.id)
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee profile not found for this user.",
        )
    return employee


@router.post("/start", response_model=StartSessionResponse, status_code=status.HTTP_201_CREATED)
def start_session(
    body: StartSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    employee = _get_employee_or_404(db, current_user)

    try:
        check_in, first_question_data = session_service.create_session(
            db=db,
            employee_id=employee.id,
            facial_score=body.facial_score,
            facial_emotions=body.facial_emotions,
        )
        db.commit()
        db.refresh(check_in)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return StartSessionResponse(
        session_id=check_in.id,
        first_question=first_question_data,
    )


@router.post("/answer", response_model=SubmitAnswerResponse)
def submit_answer(
    body: SubmitAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    employee = _get_employee_or_404(db, current_user)

    try:
        result = session_service.submit_answer(
            db=db,
            session_id=body.session_id,
            employee_id=employee.id,
            question_id=body.question_id,
            answer_index=body.answer_index,
        )
        db.commit()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return SubmitAnswerResponse(**result)


@router.get("/session/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    employee = _get_employee_or_404(db, current_user)
    detail = session_service.get_session_detail(db, session_id, employee.id)

    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found.",
        )

    return SessionDetail(**detail)


@router.get("/sessions", response_model=SessionListResponse)
def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from must be on or before date_to")
    employee = _get_employee_or_404(db, current_user)
    result = session_service.list_sessions(
        db,
        employee.id,
        page=page,
        page_size=page_size,
        date_from=date_from,
        date_to=date_to,
    )

    return SessionListResponse(**result)


@router.get("/log", response_model=list[DepressionLogEntry])
def get_depression_log(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from must be on or before date_to")
    employee = _get_employee_or_404(db, current_user)
    return session_service.list_depression_log(db, employee.id, date_from=date_from, date_to=date_to)


@router.get("/log/export-pdf")
def export_depression_log_pdf(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from must be on or before date_to")

    employee = _get_employee_or_404(db, current_user)
    entries = session_service.list_depression_log(db, employee.id, date_from=date_from, date_to=date_to)

    try:
        pdf_bytes = build_depression_log_pdf(
            employee_name=employee.user.full_name if employee.user else "Employee",
            entries=entries,
            date_from=date_from,
            date_to=date_to,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    file_name = f"mindwell-depression-log-{employee.id}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/scoring-config", response_model=ScoringConfigRead)
def get_scoring_config(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN, UserRole.EMPLOYEE)),
):
    config = get_or_create_config(db)
    return ScoringConfigRead(
        facial_weight=config.facial_weight,
        questionnaire_weight=config.questionnaire_weight,
        updated_by_user_id=config.updated_by_user_id,
        updated_at=config.updated_at,
    )


@router.put("/scoring-config", response_model=ScoringConfigRead)
def update_scoring_config(
    payload: ScoringConfigUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.SYSTEM_ADMIN)),
):
    try:
        config = update_weights(
            db,
            facial_weight=payload.facial_weight,
            questionnaire_weight=payload.questionnaire_weight,
            actor_user_id=current_user.id,
        )
        db.commit()
        db.refresh(config)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return ScoringConfigRead(
        facial_weight=config.facial_weight,
        questionnaire_weight=config.questionnaire_weight,
        updated_by_user_id=config.updated_by_user_id,
        updated_at=config.updated_at,
    )


@router.get("/symptom-frequency", response_model=list[SymptomFrequencyItem])
def get_symptom_frequency(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    employee = _get_employee_or_404(db, current_user)
    return session_service.get_symptom_frequency(db, employee.id)


@router.get("/streak", response_model=StreakInfo)
def get_streak(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    employee = _get_employee_or_404(db, current_user)
    return session_service.get_streak_info(db, employee.id)


@router.get("/consultant-advisory")
def get_consultant_advisory(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> dict:
    from app.services.consultant_service import get_employee_sad_session_count, get_company_consultants_active
    employee = _get_employee_or_404(db, current_user)
    sad_count = get_employee_sad_session_count(db, employee.id)
    should_advise = sad_count >= 2
    consultants_available = len(get_company_consultants_active(db, employee.company_id)) > 0
    return {
        "should_advise": should_advise,
        "sad_session_count": sad_count,
        "consultants_available": consultants_available,
    }
