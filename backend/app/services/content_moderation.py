from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModerationResult:
    status: str
    reason: str | None = None


# Conservative keyword-based safety filter. Content matched here is auto-removed.
CRISIS_KEYWORDS = {
    "kill myself",
    "suicide",
    "end my life",
    "self harm",
    "harm myself",
    "overdose",
    "want to die",
}

HARMFUL_KEYWORDS = {
    "go die",
    "worthless",
    "hate you",
    "idiot",
    "stupid",
    "loser",
    "hurt them",
    "violent",
}


def moderate_text(content: str) -> ModerationResult:
    normalized = " ".join((content or "").strip().lower().split())
    if not normalized:
        return ModerationResult(status="removed", reason="Empty content is not allowed.")

    for keyword in CRISIS_KEYWORDS:
        if keyword in normalized:
            return ModerationResult(status="removed", reason="Removed by crisis safety filter.")

    for keyword in HARMFUL_KEYWORDS:
        if keyword in normalized:
            return ModerationResult(status="removed", reason="Removed by harmful-language filter.")

    return ModerationResult(status="approved")
