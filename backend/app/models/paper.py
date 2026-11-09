from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Paper(Base):
    """A real publication fetched from an external source (never typed in by a client).

    Papers are a shared cache keyed by (source, external_id) and, when known, DOI. Who can SEE a
    paper is decided only by `project_papers` (a paper is visible to the owner of a project that
    saved it), so one user's reading list is never exposed to another.
    """

    __tablename__ = "papers"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_papers_source_external_id"),
        Index("uq_papers_doi", "doi", unique=True, postgresql_where=text("doi IS NOT NULL")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # provider id, see services/discovery.py
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)  # lower-case, no URL prefix
    pmid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pmcid: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # "PMC1234567"
    arxiv_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    publisher_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # landing page the source gave
    oa_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # open-access full text the source gave
    publication_type: Mapped[str | None] = mapped_column(String(24), nullable=True)  # see services/verify.py PUBLICATION_TYPES
    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(255), nullable=True)
    authors: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cited_by_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    keywords: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # OpenAlex work ids this paper cites (used to draw citation links between saved papers)
    reference_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # rule-based metadata with the matched text as evidence (see services/extraction.py)
    extracted: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ProjectPaper(Base):
    __tablename__ = "project_papers"

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_project_papers_project_id_projects"),
        primary_key=True,
    )
    paper_id: Mapped[int] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE", name="fk_project_papers_paper_id_papers"),
        primary_key=True,
        index=True,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
