"""paper identifiers (PMCID, arXiv id, publisher URL) and wider external ids

Revision ID: 0004
Revises: 0003

Additive: three nullable columns and two indexes. `external_id` is widened from 64 to 255
characters because a Crossref record is identified by its DOI, which can be long.
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("papers", "external_id", existing_type=sa.String(length=64), type_=sa.String(length=255), existing_nullable=False)
    op.add_column("papers", sa.Column("pmcid", sa.String(length=32), nullable=True))
    op.add_column("papers", sa.Column("arxiv_id", sa.String(length=64), nullable=True))
    op.add_column("papers", sa.Column("publisher_url", sa.Text(), nullable=True))
    op.create_index("ix_papers_pmcid", "papers", ["pmcid"])
    op.create_index("ix_papers_arxiv_id", "papers", ["arxiv_id"])


def downgrade() -> None:
    op.drop_index("ix_papers_arxiv_id", table_name="papers")
    op.drop_index("ix_papers_pmcid", table_name="papers")
    op.drop_column("papers", "publisher_url")
    op.drop_column("papers", "arxiv_id")
    op.drop_column("papers", "pmcid")
    op.alter_column("papers", "external_id", existing_type=sa.String(length=255), type_=sa.String(length=64), existing_nullable=False)
