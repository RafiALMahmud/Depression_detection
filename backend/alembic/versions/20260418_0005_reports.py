"""add reports table

Revision ID: 20260418_0005
Revises: 20260418_0004
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260418_0005"
down_revision = "20260418_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("department_id", sa.Integer(), nullable=False, index=True),
        sa.Column("company_id", sa.Integer(), nullable=False, index=True),
        sa.Column(
            "manager_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("version", sa.Integer(), nullable=False, default=1),
        sa.Column("assessment", sa.Text(), nullable=True),
        sa.Column("behavioral_patterns", sa.Text(), nullable=True),
        sa.Column("recommended_interventions", sa.Text(), nullable=True),
        sa.Column("flagged_employee_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("department_summary", JSONB(), nullable=True),
        sa.Column("flagged_employees_data", JSONB(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="submitted"),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("reports")
