"""add compliance_status to employees

Revision ID: 20260418_0004
Revises: 20260416_0003
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa

revision = "20260418_0004"
down_revision = "20260416_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column(
            "compliance_status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
    )


def downgrade() -> None:
    op.drop_column("employees", "compliance_status")
