"""authentication, guest trial and project ownership

Revision ID: 0002
Revises: 0001

Data safety: existing projects are NEVER deleted or exposed to every user. If any exist they are
assigned to a disabled system account (legacy@researchforge.invalid, no usable password, cannot
log in). An operator can hand them to a real account later with:
    python -m app.scripts.claim_legacy --email you@example.com
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

LEGACY_EMAIL = "legacy@researchforge.invalid"


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("auth_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),
    )

    op.create_table(
        "guest_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("trial_used", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_guest_sessions_token_hash"),
    )
    op.create_index("ix_guest_sessions_expires_at", "guest_sessions", ["expires_at"])

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("family_id", sa.String(length=36), nullable=False),
        sa.Column("persistent", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_refresh_sessions_user_id_users", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("token_hash", name="uq_refresh_sessions_token_hash"),
    )
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])
    op.create_index("ix_refresh_sessions_family_id", "refresh_sessions", ["family_id"])

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_auth_tokens_user_id_users", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
    )
    op.create_index("ix_auth_tokens_user_purpose", "auth_tokens", ["user_id", "purpose"])

    # --- project ownership: add nullable columns first, backfill, THEN enforce the CHECK ---
    op.add_column("projects", sa.Column("owner_user_id", sa.Integer(), nullable=True))
    op.add_column("projects", sa.Column("guest_session_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_projects_owner_user_id_users", "projects", "users", ["owner_user_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_projects_guest_session_id_guest_sessions",
        "projects",
        "guest_sessions",
        ["guest_session_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_projects_owner_user_id", "projects", ["owner_user_id"])
    op.create_index(
        "uq_projects_guest_session_id",
        "projects",
        ["guest_session_id"],
        unique=True,
        postgresql_where=sa.text("guest_session_id IS NOT NULL"),
    )

    # Backfill: park pre-existing projects on a disabled system user (only created if needed).
    op.execute(
        f"""
        INSERT INTO users (full_name, email, password_hash, is_verified, is_active)
        SELECT 'Legacy projects (unassigned)', '{LEGACY_EMAIL}', '!disabled', true, false
        WHERE EXISTS (SELECT 1 FROM projects)
        ON CONFLICT (email) DO NOTHING
        """
    )
    op.execute(
        f"""
        UPDATE projects
        SET owner_user_id = (SELECT id FROM users WHERE email = '{LEGACY_EMAIL}')
        WHERE owner_user_id IS NULL AND guest_session_id IS NULL
        """
    )

    op.create_check_constraint(
        "ck_projects_exactly_one_owner", "projects", "num_nonnulls(owner_user_id, guest_session_id) = 1"
    )


def downgrade() -> None:
    # Projects are kept (ownership information is dropped; the legacy placeholder user is removed).
    op.drop_constraint("ck_projects_exactly_one_owner", "projects", type_="check")
    op.drop_index("uq_projects_guest_session_id", table_name="projects")
    op.drop_index("ix_projects_owner_user_id", table_name="projects")
    op.drop_constraint("fk_projects_guest_session_id_guest_sessions", "projects", type_="foreignkey")
    op.drop_constraint("fk_projects_owner_user_id_users", "projects", type_="foreignkey")
    op.drop_column("projects", "guest_session_id")
    op.drop_column("projects", "owner_user_id")
    op.drop_table("auth_tokens")
    op.drop_table("refresh_sessions")
    op.drop_table("guest_sessions")
    op.drop_table("users")
