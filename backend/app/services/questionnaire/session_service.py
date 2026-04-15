"""Service layer for check-in sessions and questionnaire flow.

Handles session creation, answer submission, score computation, and retrieval.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.check_in_session import CheckInSession
from app.models.employee import Employee
from app.models.questionnaire_response import QuestionnaireResponse
from app.services.questionnaire.branching import (
    build_question_sequence,
    compute_score,
    estimate_total_questions,
    get_next_question,
    is_complete,
)
from app.services.questionnaire.question_bank import QUESTIONS, get_question


def _classify_tier(score: float) -> str:
    if score <= 25:
        return "low"
    if score <= 50:
        return "moderate"
    if score <= 75:
        return "high"
    return "severe"


def _load_answers(db: Session, session_id: int) -> dict[str, int]:
    """Load all existing answers for a session as {question_id: score}."""
    rows = (
        db.query(QuestionnaireResponse.question_id, QuestionnaireResponse.score)
        .filter(QuestionnaireResponse.session_id == session_id)
        .order_by(QuestionnaireResponse.sequence_order)
        .all()
    )
    return {row.question_id: row.score for row in rows}


def get_employee_for_user(db: Session, user_id: int) -> Employee | None:
    return db.query(Employee).filter(Employee.user_id == user_id).first()


def create_session(
    db: Session,
    employee_id: int,
    facial_score: float,
    facial_emotions: dict | None = None,
) -> tuple[CheckInSession, dict]:
    """Create a new check-in session and return it along with the first question info."""
    session = CheckInSession(
        employee_id=employee_id,
        facial_score=facial_score,
        facial_emotions=facial_emotions,
        status="in_progress",
    )
    db.add(session)
    db.flush()

    first_question = get_next_question({})
    if first_question is None:
        raise ValueError("Question bank is empty — cannot start questionnaire.")

    session.questions_asked = [first_question.id]

    return session, _question_to_dict(first_question, sequence_order=1, total_estimated=estimate_total_questions({}))


def submit_answer(
    db: Session,
    session_id: int,
    employee_id: int,
    question_id: str,
    answer_index: int,
) -> dict:
    """Submit an answer and return either the next question or the completion summary."""
    session = (
        db.query(CheckInSession)
        .filter(CheckInSession.id == session_id, CheckInSession.employee_id == employee_id)
        .first()
    )
    if session is None:
        raise ValueError("Session not found or access denied.")

    if session.status != "in_progress":
        raise ValueError("This session has already been completed.")

    question = get_question(question_id)
    if question is None:
        raise ValueError(f"Unknown question ID: {question_id}")

    if answer_index < 0 or answer_index >= len(question.options):
        raise ValueError(f"Invalid answer index {answer_index} for question {question_id}.")

    # Check for duplicate answer
    existing = (
        db.query(QuestionnaireResponse)
        .filter(
            QuestionnaireResponse.session_id == session_id,
            QuestionnaireResponse.question_id == question_id,
        )
        .first()
    )
    if existing is not None:
        raise ValueError(f"Question {question_id} has already been answered in this session.")

    option = question.options[answer_index]
    current_count = (
        db.query(QuestionnaireResponse)
        .filter(QuestionnaireResponse.session_id == session_id)
        .count()
    )

    response = QuestionnaireResponse(
        session_id=session_id,
        question_id=question_id,
        question_text=question.text,
        domain=question.domain,
        answer_index=answer_index,
        answer_label=option.label,
        score=option.score,
        sequence_order=current_count + 1,
    )
    db.add(response)
    db.flush()

    answers = _load_answers(db, session_id)
    next_question = get_next_question(answers)

    if next_question is not None:
        # Update questions_asked
        asked = list(session.questions_asked or [])
        if next_question.id not in asked:
            asked.append(next_question.id)
        session.questions_asked = asked

        return {
            "is_complete": False,
            "next_question": _question_to_dict(
                next_question,
                sequence_order=current_count + 2,
                total_estimated=estimate_total_questions(answers),
            ),
            "questionnaire_score": None,
            "composite_score": None,
            "threshold_tier": None,
        }

    # Questionnaire complete — compute scores
    questionnaire_score = compute_score(answers)
    facial_weight = session.score_weight_facial
    qnaire_weight = session.score_weight_questionnaire
    composite = round(
        (session.facial_score or 0) * facial_weight + questionnaire_score * qnaire_weight, 2
    )
    tier = _classify_tier(composite)

    session.questionnaire_score = questionnaire_score
    session.composite_score = composite
    session.threshold_tier = tier
    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)

    # Finalize questions_asked
    session.questions_asked = build_question_sequence(answers)

    return {
        "is_complete": True,
        "next_question": None,
        "questionnaire_score": questionnaire_score,
        "composite_score": composite,
        "threshold_tier": tier,
    }


def get_session_detail(db: Session, session_id: int, employee_id: int) -> dict | None:
    """Return a full session detail including all question/answer pairs."""
    session = (
        db.query(CheckInSession)
        .filter(CheckInSession.id == session_id, CheckInSession.employee_id == employee_id)
        .first()
    )
    if session is None:
        return None

    responses = (
        db.query(QuestionnaireResponse)
        .filter(QuestionnaireResponse.session_id == session_id)
        .order_by(QuestionnaireResponse.sequence_order)
        .all()
    )

    return {
        "session_id": session.id,
        "facial_score": session.facial_score,
        "facial_emotions": session.facial_emotions,
        "questionnaire_score": session.questionnaire_score,
        "composite_score": session.composite_score,
        "threshold_tier": session.threshold_tier,
        "status": session.status,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None,
        "questions_and_answers": [
            {
                "question_id": r.question_id,
                "question_text": r.question_text,
                "domain": r.domain,
                "answer_index": r.answer_index,
                "answer_label": r.answer_label,
                "score": r.score,
                "sequence_order": r.sequence_order,
            }
            for r in responses
        ],
    }


def list_sessions(
    db: Session,
    employee_id: int,
    page: int = 1,
    page_size: int = 10,
) -> dict:
    """Return a paginated list of completed sessions for an employee."""
    query = (
        db.query(CheckInSession)
        .filter(CheckInSession.employee_id == employee_id)
        .order_by(CheckInSession.created_at.desc())
    )
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [
            {
                "session_id": s.id,
                "facial_score": s.facial_score,
                "questionnaire_score": s.questionnaire_score,
                "composite_score": s.composite_score,
                "threshold_tier": s.threshold_tier,
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            }
            for s in items
        ],
        "meta": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


def _question_to_dict(question, sequence_order: int, total_estimated: int) -> dict:
    return {
        "id": question.id,
        "text": question.text,
        "domain": question.domain,
        "options": [{"label": opt.label, "score": opt.score} for opt in question.options],
        "sequence_order": sequence_order,
        "total_estimated": total_estimated,
    }
