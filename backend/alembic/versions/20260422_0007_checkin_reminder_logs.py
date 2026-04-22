"""add check-in reminder logs

Revision ID: 20260422_0007
Revises: 20260419_0006
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa

revision = "20260422_0007"
down_revision = "20260419_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "check_in_reminder_logs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("reminder_type", sa.String(length=40), nullable=False, server_default="next_session"),
        sa.Column("reminder_for_date", sa.Date(), nullable=False, index=True),
        sa.Column("next_session_date", sa.Date(), nullable=False),
        sa.Column("days_since_last_checkin", sa.Integer(), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "employee_id",
            "reminder_for_date",
            "reminder_type",
            name="uq_checkin_reminder_employee_date_type",
        ),
    )


def downgrade() -> None:
    op.drop_table("check_in_reminder_logs")
