"""Rule-based adaptive branching engine for the PHQ-9-inspired questionnaire.

Determines which questions to present based on prior answers, enforcing
a minimum of 5 and maximum of 10 questions per session.
"""

from __future__ import annotations

from app.services.questionnaire.question_bank import (
    MAX_QUESTIONS,
    MIN_QUESTIONS,
    PAD_QUESTION_IDS,
    QUESTIONS,
    ROOT_QUESTION_IDS,
    Question,
)


def _get_triggered_followups(answers: dict[str, int]) -> list[str]:
    """Return ordered list of conditional question IDs triggered by the answers so far."""
    triggered: list[str] = []

    q2_score = answers.get("Q2", 0)
    q3_score = answers.get("Q3", 0)
    q1_score = answers.get("Q1", 0)

    # Q3 (Energy) >= 2 triggers Q5 (Sleep) and Q6 (Appetite)
    if q3_score >= 2:
        triggered.append("Q5")
        triggered.append("Q6")

    # Q2 (Low Mood) >= 2 triggers Q7 (Self-Worth)
    if q2_score >= 2:
        triggered.append("Q7")

    # Q2 >= 2 AND Q3 >= 2 triggers Q8 (Psychomotor)
    if q2_score >= 2 and q3_score >= 2:
        triggered.append("Q8")

    # Q1 + Q2 >= 3 triggers Q9 (Functional Impact)
    if q1_score + q2_score >= 3:
        triggered.append("Q9")

    # Q7 (Self-Worth) >= 2 triggers Q10 (Suicidal Ideation)
    q7_score = answers.get("Q7", 0)
    if "Q7" in answers and q7_score >= 2:
        triggered.append("Q10")

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for qid in triggered:
        if qid not in seen:
            seen.add(qid)
            unique.append(qid)

    return unique


def build_question_sequence(answers: dict[str, int]) -> list[str]:
    """Build the full ordered list of question IDs for this session given answers so far.

    Starts with the 4 root questions, adds conditional follow-ups triggered by
    answers, then pads to MIN_QUESTIONS if needed. Never exceeds MAX_QUESTIONS.
    """
    sequence: list[str] = list(ROOT_QUESTION_IDS)

    triggered = _get_triggered_followups(answers)
    for qid in triggered:
        if qid not in sequence and len(sequence) < MAX_QUESTIONS:
            sequence.append(qid)

    # Pad to minimum if branching produced fewer than MIN_QUESTIONS
    if len(sequence) < MIN_QUESTIONS:
        for qid in PAD_QUESTION_IDS:
            if qid not in sequence and len(sequence) < MIN_QUESTIONS:
                sequence.append(qid)

    return sequence


def get_next_question(answers: dict[str, int]) -> Question | None:
    """Return the next unanswered question, or None if the questionnaire is complete."""
    sequence = build_question_sequence(answers)

    for qid in sequence:
        if qid not in answers:
            return QUESTIONS[qid]

    return None


def is_complete(answers: dict[str, int]) -> bool:
    """Check whether the questionnaire is done (all triggered questions answered)."""
    return get_next_question(answers) is None


def compute_score(answers: dict[str, int]) -> float:
    """Compute the normalized questionnaire score (0-100) from all answers."""
    if not answers:
        return 0.0

    raw_score = sum(answers.values())
    max_possible = len(answers) * 3

    if max_possible == 0:
        return 0.0

    return round((raw_score / max_possible) * 100, 2)


def estimate_total_questions(answers: dict[str, int]) -> int:
    """Estimate the total number of questions based on current answers.

    This gives the frontend a sense of progress even though the final count
    depends on future answers.
    """
    return len(build_question_sequence(answers))
