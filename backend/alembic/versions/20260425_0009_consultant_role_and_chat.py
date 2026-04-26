"""add consultant role, consultants table, consultation threads and messages

Revision ID: 20260425_0009
Revises: 20260423_0008
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260425_0009"
down_revision = "20260423_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend the user_role enum in PostgreSQL
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'consultant'")

    op.create_table(
        "consultants",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("professional_title", sa.String(150), nullable=True),
        sa.Column("specialization", sa.String(150), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_table(
        "consultation_threads",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("employee_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("consultant_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("anonymous_alias", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open", index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_table(
        "consultation_messages",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("thread_id", sa.Integer(), sa.ForeignKey("consultation_threads.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("sender_role", sa.String(30), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("message_body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("consultation_messages")
    op.drop_table("consultation_threads")
    op.drop_table("consultants")
    # Note: PostgreSQL does not support removing enum values directly.
    # To remove 'consultant' from user_role, a full enum recreation would be needed.
