"""publication type and open-access URL on papers

Revision ID: 0005
Revises: 0004

Additive: two nullable columns. Existing rows stay NULL (type shown as "not stated" until the paper is saved again).
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("papers", sa.Column("oa_url", sa.Text(), nullable=True))
    op.add_column("papers", sa.Column("publication_type", sa.String(length=24), nullable=True))


def downgrade() -> None:
    op.drop_column("papers", "publication_type")
    op.drop_column("papers", "oa_url")
