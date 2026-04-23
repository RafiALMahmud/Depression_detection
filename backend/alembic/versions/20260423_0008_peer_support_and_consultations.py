"""add peer support board and consultations

Revision ID: 20260423_0008
Revises: 20260422_0007
Create Date: 2026-04-23
"""

from alembic import op
import sqlalchemy as sa

revision = "20260423_0008"
down_revision = "20260422_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "peer_support_threads",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "author_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content_encrypted", sa.Text(), nullable=False),
        sa.Column("moderation_status", sa.String(length=20), nullable=False, server_default="approved", index=True),
        sa.Column("moderation_reason", sa.String(length=255), nullable=True),
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    op.create_table(
        "peer_support_replies",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "thread_id",
            sa.Integer(),
            sa.ForeignKey("peer_support_threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "author_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content_encrypted", sa.Text(), nullable=False),
        sa.Column("moderation_status", sa.String(length=20), nullable=False, server_default="approved", index=True),
        sa.Column("moderation_reason", sa.String(length=255), nullable=True),
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    op.create_table(
        "peer_support_reactions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "thread_id",
            sa.Integer(),
            sa.ForeignKey("peer_support_threads.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "reactor_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("reaction_type", sa.String(length=50), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("thread_id", "reactor_user_id", name="uq_peer_support_reactions_thread_reactor"),
    )

    op.create_table(
        "consultation_team_configs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("provider_name", sa.String(length=150), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("guidance_note", sa.Text(), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    op.create_table(
        "counselor_consultation_requests",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "source_session_id",
            sa.Integer(),
            sa.ForeignKey("check_in_sessions.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("threshold_tier", sa.String(length=20), nullable=False, index=True),
        sa.Column("request_note_encrypted", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending", index=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduler_note_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "scheduled_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("counselor_consultation_requests")
    op.drop_table("consultation_team_configs")
    op.drop_table("peer_support_reactions")
    op.drop_table("peer_support_replies")
    op.drop_table("peer_support_threads")
