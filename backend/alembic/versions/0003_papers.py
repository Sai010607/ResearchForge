"""papers and project_papers (real literature saved to projects)

Revision ID: 0003
Revises: 0002

Additive only: no existing table or row is changed.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "papers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("doi", sa.String(length=255), nullable=True),
        sa.Column("pmid", sa.String(length=32), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("abstract", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("venue", sa.String(length=255), nullable=True),
        sa.Column("authors", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("cited_by_count", sa.Integer(), nullable=True),
        sa.Column("keywords", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("reference_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("extracted", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "external_id", name="uq_papers_source_external_id"),
    )
    op.create_index("uq_papers_doi", "papers", ["doi"], unique=True, postgresql_where=sa.text("doi IS NOT NULL"))
    op.create_table(
        "project_papers",
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("paper_id", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], name="fk_project_papers_project_id_projects", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], name="fk_project_papers_paper_id_papers", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "paper_id"),
    )
    op.create_index("ix_project_papers_paper_id", "project_papers", ["paper_id"])


def downgrade() -> None:
    op.drop_index("ix_project_papers_paper_id", table_name="project_papers")
    op.drop_table("project_papers")
    op.drop_index("uq_papers_doi", table_name="papers")
    op.drop_table("papers")
