from __future__ import annotations

from pydantic import BaseModel, Field


class OptionOut(BaseModel):
    label: str
    score: int


class QuestionOut(BaseModel):
    id: str
    text: str
    domain: str
    options: list[OptionOut]
    sequence_order: int
    total_estimated: int


class StartSessionRequest(BaseModel):
    facial_score: float = Field(..., ge=0, le=100)
    facial_emotions: dict | None = None


class StartSessionResponse(BaseModel):
    session_id: int
    first_question: QuestionOut


class SubmitAnswerRequest(BaseModel):
    session_id: int
    question_id: str
    answer_index: int = Field(..., ge=0, le=3)


class SubmitAnswerResponse(BaseModel):
    is_complete: bool
    next_question: QuestionOut | None = None
    questionnaire_score: float | None = None
    composite_score: float | None = None
    threshold_tier: str | None = None


class AnswerDetail(BaseModel):
    question_id: str
    question_text: str
    domain: str
    answer_index: int
    answer_label: str
    score: int
    sequence_order: int


class SessionDetail(BaseModel):
    session_id: int
    facial_score: float | None
    facial_emotions: dict | None = None
    questionnaire_score: float | None
    composite_score: float | None
    threshold_tier: str | None
    status: str
    created_at: str | None
    completed_at: str | None
    questions_and_answers: list[AnswerDetail]


class SessionListItem(BaseModel):
    session_id: int
    facial_score: float | None
    questionnaire_score: float | None
    composite_score: float | None
    threshold_tier: str | None
    status: str
    created_at: str | None
    completed_at: str | None


class SessionListMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class SessionListResponse(BaseModel):
    items: list[SessionListItem]
    meta: SessionListMeta
