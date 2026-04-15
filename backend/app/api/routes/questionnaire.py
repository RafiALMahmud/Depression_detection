from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.questionnaire import (
    SessionDetail,
    SessionListResponse,
    StartSessionRequest,
    StartSessionResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
)
from app.services.questionnaire import session_service

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
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
):
    employee = _get_employee_or_404(db, current_user)
    result = session_service.list_sessions(db, employee.id, page=page, page_size=page_size)

    return SessionListResponse(**result)
