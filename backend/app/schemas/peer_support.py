from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import PaginationMeta

ReactionType = Literal["you_are_not_alone", "sending_support", "take_a_breath", "stay_strong"]


class PeerSupportThreadCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=600)

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Content cannot be empty")
        return normalized


class PeerSupportReplyCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=400)

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Content cannot be empty")
        return normalized


class PeerSupportReactionUpdate(BaseModel):
    reaction_type: ReactionType | None = None


class PeerSupportReactionCount(BaseModel):
    reaction_type: ReactionType
    count: int


class PeerSupportReplyRead(BaseModel):
    id: int
    alias: str
    content: str
    moderation_status: str
    moderation_reason: str | None
    created_at: datetime


class PeerSupportThreadRead(BaseModel):
    id: int
    alias: str
    content: str
    created_at: datetime
    moderation_status: str
    moderation_reason: str | None
    reply_count: int
    can_delete: bool
    reactions: list[PeerSupportReactionCount]
    my_reaction: ReactionType | None
    replies: list[PeerSupportReplyRead]


class PeerSupportThreadListResponse(BaseModel):
    items: list[PeerSupportThreadRead]
    meta: PaginationMeta
