"""Add check-in sessions and questionnaire responses

Revision ID: 20260416_0003
Revises: 20260412_0002
Create Date: 2026-04-16 12:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260416_0003"
down_revision = "20260412_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "check_in_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("facial_score", sa.Float(), nullable=True),
        sa.Column("facial_emotions", JSONB(), nullable=True),
        sa.Column("questionnaire_score", sa.Float(), nullable=True),
        sa.Column("composite_score", sa.Float(), nullable=True),
        sa.Column("threshold_tier", sa.String(length=20), nullable=True),
        sa.Column("score_weight_facial", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("score_weight_questionnaire", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("questions_asked", JSONB(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="in_progress"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    op.create_table(
        "questionnaire_responses",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("check_in_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("question_id", sa.String(length=10), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("domain", sa.String(length=50), nullable=False),
        sa.Column("answer_index", sa.Integer(), nullable=False),
        sa.Column("answer_label", sa.String(length=50), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("sequence_order", sa.Integer(), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("questionnaire_responses")
    op.drop_table("check_in_sessions")
