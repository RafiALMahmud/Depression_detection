"""PHQ-9-inspired adaptive question bank.

Defines 10 questions: 4 mandatory root questions and 6 conditional follow-ups.
Each question has a domain, text, and four Likert-scale response options scored 0-3.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Option:
    label: str
    score: int


@dataclass(frozen=True)
class Question:
    id: str
    domain: str
    text: str
    options: tuple[Option, ...] = field(default_factory=tuple)


LIKERT_OPTIONS: tuple[Option, ...] = (
    Option(label="Not at all", score=0),
    Option(label="Several days", score=1),
    Option(label="More than half the days", score=2),
    Option(label="Nearly every day", score=3),
)

QUESTIONS: dict[str, Question] = {
    "Q1": Question(
        id="Q1",
        domain="anhedonia",
        text="Over the past 2 weeks, how often have you had little interest or pleasure in doing things?",
        options=LIKERT_OPTIONS,
    ),
    "Q2": Question(
        id="Q2",
        domain="low_mood",
        text="How often have you felt down, depressed, or hopeless?",
        options=LIKERT_OPTIONS,
    ),
    "Q3": Question(
        id="Q3",
        domain="energy",
        text="How often have you felt tired or had little energy?",
        options=LIKERT_OPTIONS,
    ),
    "Q4": Question(
        id="Q4",
        domain="concentration",
        text="How often have you had trouble concentrating on things?",
        options=LIKERT_OPTIONS,
    ),
    "Q5": Question(
        id="Q5",
        domain="sleep",
        text="How often have you had trouble falling or staying asleep, or sleeping too much?",
        options=LIKERT_OPTIONS,
    ),
    "Q6": Question(
        id="Q6",
        domain="appetite",
        text="How often have you had poor appetite or been overeating?",
        options=LIKERT_OPTIONS,
    ),
    "Q7": Question(
        id="Q7",
        domain="self_worth",
        text=(
            "How often have you felt bad about yourself — or that you are a failure "
            "or have let yourself or your family down?"
        ),
        options=LIKERT_OPTIONS,
    ),
    "Q8": Question(
        id="Q8",
        domain="psychomotor",
        text=(
            "How often have you been moving or speaking so slowly that other people have noticed? "
            "Or the opposite — being so fidgety or restless?"
        ),
        options=LIKERT_OPTIONS,
    ),
    "Q9": Question(
        id="Q9",
        domain="functional_impact",
        text=(
            "How difficult have these problems made it for you to do your work, "
            "take care of things at home, or get along with other people?"
        ),
        options=LIKERT_OPTIONS,
    ),
    "Q10": Question(
        id="Q10",
        domain="suicidal_ideation",
        text=(
            "How often have you had thoughts that you would be better off not being here, "
            "or of hurting yourself in some way?"
        ),
        options=LIKERT_OPTIONS,
    ),
}

ROOT_QUESTION_IDS: list[str] = ["Q1", "Q2", "Q3", "Q4"]

# Questions used to pad if fewer than 5 are triggered by branching
PAD_QUESTION_IDS: list[str] = ["Q5", "Q6", "Q9"]

MAX_QUESTIONS = 10
MIN_QUESTIONS = 5


def get_question(question_id: str) -> Question | None:
    return QUESTIONS.get(question_id)
