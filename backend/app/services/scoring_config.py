from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.scoring_config import ScoringConfig

DEFAULT_FACIAL_WEIGHT = 0.5
DEFAULT_QUESTIONNAIRE_WEIGHT = 0.5


def _normalize_weights(facial_weight: float, questionnaire_weight: float) -> tuple[float, float]:
    if facial_weight < 0 or questionnaire_weight < 0:
        raise ValueError("Weights must be non-negative.")

    total = facial_weight + questionnaire_weight
    if total <= 0:
        raise ValueError("At least one weight must be greater than zero.")

    normalized_facial = round(facial_weight / total, 4)
    normalized_questionnaire = round(questionnaire_weight / total, 4)

    # Keep deterministic sum at exactly 1.0 after rounding.
    if normalized_facial + normalized_questionnaire != 1.0:
        normalized_questionnaire = round(1.0 - normalized_facial, 4)

    return normalized_facial, normalized_questionnaire


def get_or_create_config(db: Session) -> ScoringConfig:
    config = db.query(ScoringConfig).order_by(ScoringConfig.id.asc()).first()
    if config is None:
        config = ScoringConfig(
            facial_weight=DEFAULT_FACIAL_WEIGHT,
            questionnaire_weight=DEFAULT_QUESTIONNAIRE_WEIGHT,
        )
        db.add(config)
        db.flush()
    return config


def get_effective_weights(db: Session) -> tuple[float, float]:
    config = get_or_create_config(db)
    facial = float(config.facial_weight or DEFAULT_FACIAL_WEIGHT)
    questionnaire = float(config.questionnaire_weight or DEFAULT_QUESTIONNAIRE_WEIGHT)
    try:
        return _normalize_weights(facial, questionnaire)
    except ValueError:
        return DEFAULT_FACIAL_WEIGHT, DEFAULT_QUESTIONNAIRE_WEIGHT


def update_weights(
    db: Session,
    *,
    facial_weight: float,
    questionnaire_weight: float,
    actor_user_id: int | None,
) -> ScoringConfig:
    normalized_facial, normalized_questionnaire = _normalize_weights(facial_weight, questionnaire_weight)
    config = get_or_create_config(db)
    config.facial_weight = normalized_facial
    config.questionnaire_weight = normalized_questionnaire
    config.updated_by_user_id = actor_user_id
    db.flush()
    return config
