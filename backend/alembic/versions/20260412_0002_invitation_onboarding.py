"""Add invitation onboarding schema

Revision ID: 20260412_0002
Revises: 20260412_0001
Create Date: 2026-04-12 06:15:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260412_0002"
down_revision = "20260412_0001"
branch_labels = None
depends_on = None


invitation_status = postgresql.ENUM(
    "pending",
    "used",
    "expired",
    "cancelled",
    name="invitation_status",
    create_type=False,
)


def upgrade() -> None:
    invitation_status.create(op.get_bind(), checkfirst=True)

    op.add_column("users", sa.Column("invited_by_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_invited_by_user_id_users",
        "users",
        "users",
        ["invited_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_users_invited_by_user_id", "users", ["invited_by_user_id"])
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=True)

    op.create_table(
        "invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM(
                "super_admin",
                "system_admin",
                "company_head",
                "department_manager",
                "employee",
                name="user_role",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("invitation_code_hash", sa.String(length=255), nullable=False),
        sa.Column("status", invitation_status, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_invitations_id", "invitations", ["id"])
    op.create_index("ix_invitations_user_id", "invitations", ["user_id"])
    op.create_index("ix_invitations_email", "invitations", ["email"])
    op.create_index("ix_invitations_role", "invitations", ["role"])
    op.create_index("ix_invitations_company_id", "invitations", ["company_id"])
    op.create_index("ix_invitations_department_id", "invitations", ["department_id"])
    op.create_index("ix_invitations_invitation_code_hash", "invitations", ["invitation_code_hash"])
    op.create_index("ix_invitations_status", "invitations", ["status"])


def downgrade() -> None:
    op.drop_index("ix_invitations_status", table_name="invitations")
    op.drop_index("ix_invitations_invitation_code_hash", table_name="invitations")
    op.drop_index("ix_invitations_department_id", table_name="invitations")
    op.drop_index("ix_invitations_company_id", table_name="invitations")
    op.drop_index("ix_invitations_role", table_name="invitations")
    op.drop_index("ix_invitations_email", table_name="invitations")
    op.drop_index("ix_invitations_user_id", table_name="invitations")
    op.drop_index("ix_invitations_id", table_name="invitations")
    op.drop_table("invitations")

    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=False)
    op.drop_index("ix_users_invited_by_user_id", table_name="users")
    op.drop_constraint("fk_users_invited_by_user_id_users", "users", type_="foreignkey")
    op.drop_column("users", "invited_by_user_id")

    invitation_status.drop(op.get_bind(), checkfirst=True)
