from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.peer_support_thread import PeerSupportThread
    from app.models.user import User


class PeerSupportReaction(Base):
    __tablename__ = "peer_support_reactions"
    __table_args__ = (
        UniqueConstraint("thread_id", "reactor_user_id", name="uq_peer_support_reactions_thread_reactor"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    thread_id: Mapped[int] = mapped_column(
        ForeignKey("peer_support_threads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reactor_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reaction_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    thread: Mapped["PeerSupportThread"] = relationship(back_populates="reactions")
    reactor: Mapped["User"] = relationship()
