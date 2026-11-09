"""project-level research memory

Revision ID: 0006
Revises: 0005

Additive only: seven new tables, all scoped to projects with ON DELETE CASCADE. No existing table or column changes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from app.models.memory import (
    CLAIM_TYPES, DECISION_STATUSES, EVIDENCE_RELATIONSHIPS, GAP_CATEGORIES, GAP_STATUSES, MEMORY_TYPES, SOURCE_TYPES, VERIFICATION, _in,
)

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

NOW = sa.text("now()")


def _ts(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=NOW, nullable=False)


def upgrade() -> None:
    op.create_table(
        "project_memories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE", name="fk_project_memories_project_id_projects"), nullable=False),
        sa.Column("summary", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_rebuilt_at", sa.DateTime(timezone=True)),
        _ts("created_at"), _ts("updated_at"),
        sa.UniqueConstraint("project_id", name="uq_project_memories_project_id"),
    )
    op.create_table(
        "memory_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE", name="fk_memory_entries_project_id_projects"), nullable=False),
        sa.Column("paper_id", sa.Integer(), sa.ForeignKey("papers.id", ondelete="CASCADE", name="fk_memory_entries_paper_id_papers")),
        sa.Column("memory_type", sa.String(24), nullable=False),
        sa.Column("field", sa.String(40), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("origin", sa.String(12), nullable=False, server_default="auto"),
        sa.Column("source_type", sa.String(24), nullable=False),
        sa.Column("source_reference", sa.Text()),
        sa.Column("extraction_method", sa.String(200)),
        sa.Column("matched_text", sa.Text()),
        sa.Column("section_name", sa.String(80)),
        sa.Column("page_number", sa.Integer()),
        sa.Column("extracted_at", sa.DateTime(timezone=True)),
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unverified"),
        sa.Column("confidence", sa.Float()),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        _ts("created_at"), _ts("updated_at"),
        sa.UniqueConstraint("project_id", "content_hash", name="uq_memory_entries_project_hash"),
        sa.CheckConstraint(_in("memory_type", MEMORY_TYPES), name="ck_memory_entries_type"),
        sa.CheckConstraint(_in("source_type", SOURCE_TYPES), name="ck_memory_entries_source_type"),
        sa.CheckConstraint(_in("verification_status", VERIFICATION), name="ck_memory_entries_verification"),
        sa.CheckConstraint("origin IN ('auto', 'researcher')", name="ck_memory_entries_origin"),
    )
    op.create_index("ix_memory_entries_project_type", "memory_entries", ["project_id", "memory_type"])
    op.create_index("ix_memory_entries_paper", "memory_entries", ["paper_id"])
    op.create_table(
        "research_claims",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE", name="fk_research_claims_project_id_projects"), nullable=False),
        sa.Column("claim_text", sa.Text(), nullable=False),
        sa.Column("claim_type", sa.String(16), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False, server_default="researcher"),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("confidence", sa.Float()),
        _ts("created_at"), _ts("updated_at"),
        sa.CheckConstraint(_in("claim_type", CLAIM_TYPES), name="ck_research_claims_type"),
        sa.CheckConstraint("origin IN ('researcher', 'rule_extracted')", name="ck_research_claims_origin"),
        sa.CheckConstraint("status IN ('active', 'retracted')", name="ck_research_claims_status"),
    )
    op.create_index("ix_research_claims_project", "research_claims", ["project_id"])
    op.create_table(
        "claim_evidence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("claim_id", sa.Integer(), sa.ForeignKey("research_claims.id", ondelete="CASCADE", name="fk_claim_evidence_claim_id_research_claims"), nullable=False),
        sa.Column("paper_id", sa.Integer(), sa.ForeignKey("papers.id", ondelete="CASCADE", name="fk_claim_evidence_paper_id_papers"), nullable=False),
        sa.Column("relationship", sa.String(16), nullable=False),
        sa.Column("evidence_kind", sa.String(12), nullable=False, server_default="quote"),
        sa.Column("quoted_text", sa.Text(), nullable=False),
        sa.Column("section_name", sa.String(80)),
        sa.Column("page_number", sa.Integer()),
        sa.Column("source_url", sa.Text()),
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unverified"),
        _ts("created_at"),
        sa.CheckConstraint(_in("relationship", EVIDENCE_RELATIONSHIPS), name="ck_claim_evidence_relationship"),
        sa.CheckConstraint("evidence_kind IN ('quote', 'paraphrase')", name="ck_claim_evidence_kind"),
        sa.CheckConstraint("verification_status IN ('source_matched', 'unverified', 'confirmed')", name="ck_claim_evidence_verification"),
    )
    op.create_index("ix_claim_evidence_claim", "claim_evidence", ["claim_id"])
    op.create_index("ix_claim_evidence_paper", "claim_evidence", ["paper_id"])
    op.create_table(
        "research_decisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE", name="fk_research_decisions_project_id_projects"), nullable=False),
        sa.Column("supersedes_id", sa.Integer(), sa.ForeignKey("research_decisions.id", ondelete="SET NULL", name="fk_research_decisions_supersedes_id")),
        sa.Column("decision_type", sa.String(32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text()),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        _ts("created_at"), _ts("updated_at"),
        sa.CheckConstraint(_in("status", DECISION_STATUSES), name="ck_research_decisions_status"),
    )
    op.create_index("ix_research_decisions_project", "research_decisions", ["project_id"])
    op.create_table(
        "research_gaps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE", name="fk_research_gaps_project_id_projects"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("gap_category", sa.String(32), nullable=False),
        sa.Column("evidence_summary", sa.Text()),
        sa.Column("researcher_comment", sa.Text()),
        sa.Column("status", sa.String(12), nullable=False, server_default="potential"),
        sa.Column("confidence", sa.Float()),
        _ts("created_at"), _ts("updated_at"),
        sa.CheckConstraint(_in("status", GAP_STATUSES), name="ck_research_gaps_status"),
        sa.CheckConstraint(_in("gap_category", GAP_CATEGORIES), name="ck_research_gaps_category"),
    )
    op.create_index("ix_research_gaps_project", "research_gaps", ["project_id"])
    op.create_table(
        "memory_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE", name="fk_memory_events_project_id_projects"), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("actor", sa.String(12), nullable=False),
        sa.Column("subject_type", sa.String(24)),
        sa.Column("subject_id", sa.Integer()),
        sa.Column("detail", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        _ts("created_at"),
        sa.CheckConstraint("actor IN ('system', 'researcher')", name="ck_memory_events_actor"),
    )
    op.create_index("ix_memory_events_project_created", "memory_events", ["project_id", "created_at"])


def downgrade() -> None:
    for table in ("memory_events", "research_gaps", "research_decisions", "claim_evidence", "research_claims", "memory_entries", "project_memories"):
        op.drop_table(table)
