"""Project-level research memory.

Everything here belongs to ONE project (ON DELETE CASCADE from `projects`), never to a user, so a project keeps its own
scientific context and another project's memory can never leak into it. Paper metadata is NOT copied: rows only reference
`papers`. Every automatically produced row records HOW it was produced (source_type / extraction_method), the exact matched
text and when, so nothing here can pass for a verified scientific finding unless a researcher confirmed it.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

MEMORY_TYPES = ("research_identity", "literature", "experiment_context")
SOURCE_TYPES = ("source_metadata", "rule_extracted", "ai_extracted", "researcher_confirmed", "researcher_entered")
VERIFICATION = ("unverified", "source_reported", "confirmed", "edited", "rejected")
EVIDENCE_RELATIONSHIPS = ("supports", "contradicts", "contextualizes", "neutral")
CLAIM_TYPES = ("finding", "hypothesis", "method", "background")
DECISION_STATUSES = ("active", "rejected", "superseded")
GAP_STATUSES = ("potential", "validated", "dismissed")
GAP_CATEGORIES = ("methodological", "dataset", "population", "evaluation", "reproducibility", "conflicting_findings", "unanswered_question", "hypothesis_to_validate")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _ts_upd() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ProjectMemory(Base):
    """One row per project: the memory's own version and last rebuild time."""

    __tablename__ = "project_memories"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_project_memories_project_id_projects"), nullable=False, unique=True
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)  # deterministic counts, never prose about science
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # counts rebuilds
    last_rebuilt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts_upd()


class MemoryEntry(Base):
    __tablename__ = "memory_entries"
    __table_args__ = (
        UniqueConstraint("project_id", "content_hash", name="uq_memory_entries_project_hash"),
        CheckConstraint(_in("memory_type", MEMORY_TYPES), name="ck_memory_entries_type"),
        CheckConstraint(_in("source_type", SOURCE_TYPES), name="ck_memory_entries_source_type"),
        CheckConstraint(_in("verification_status", VERIFICATION), name="ck_memory_entries_verification"),
        CheckConstraint("origin IN ('auto', 'researcher')", name="ck_memory_entries_origin"),
        Index("ix_memory_entries_project_type", "project_id", "memory_type"),
        Index("ix_memory_entries_paper", "paper_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_memory_entries_project_id_projects"), nullable=False
    )
    paper_id: Mapped[int | None] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE", name="fk_memory_entries_paper_id_papers"), nullable=True
    )
    memory_type: Mapped[str] = mapped_column(String(24), nullable=False)
    field: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. disease, dataset, method, sample_size, metric
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[str] = mapped_column(String(12), nullable=False, default="auto")
    source_type: Mapped[str] = mapped_column(String(24), nullable=False)
    source_reference: Mapped[str | None] = mapped_column(Text, nullable=True)  # human-readable pointer, e.g. "abstract of doi:10.x"
    extraction_method: Mapped[str | None] = mapped_column(String(200), nullable=True)
    matched_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # exact text the extractor matched
    section_name: Mapped[str | None] = mapped_column(String(80), nullable=True)  # "title" / "abstract" / "keywords"; no full text yet
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unverified")
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)  # NULL = not applicable (rule matches carry no probability)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # set when a researcher acts on it
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts_upd()


class ResearchClaim(Base):
    __tablename__ = "research_claims"
    __table_args__ = (
        CheckConstraint(_in("claim_type", CLAIM_TYPES), name="ck_research_claims_type"),
        CheckConstraint("origin IN ('researcher', 'rule_extracted')", name="ck_research_claims_origin"),
        CheckConstraint("status IN ('active', 'retracted')", name="ck_research_claims_status"),
        Index("ix_research_claims_project", "project_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_research_claims_project_id_projects"), nullable=False
    )
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    claim_type: Mapped[str] = mapped_column(String(16), nullable=False)  # only "hypothesis" may exist without evidence
    origin: Mapped[str] = mapped_column(String(16), nullable=False, default="researcher")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts_upd()


class ClaimEvidence(Base):
    __tablename__ = "claim_evidence"
    __table_args__ = (
        CheckConstraint(_in("relationship", EVIDENCE_RELATIONSHIPS), name="ck_claim_evidence_relationship"),
        CheckConstraint("evidence_kind IN ('quote', 'paraphrase')", name="ck_claim_evidence_kind"),
        CheckConstraint("verification_status IN ('source_matched', 'unverified', 'confirmed')", name="ck_claim_evidence_verification"),
        Index("ix_claim_evidence_claim", "claim_id"),
        Index("ix_claim_evidence_paper", "paper_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    claim_id: Mapped[int] = mapped_column(
        ForeignKey("research_claims.id", ondelete="CASCADE", name="fk_claim_evidence_claim_id_research_claims"), nullable=False
    )
    paper_id: Mapped[int] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE", name="fk_claim_evidence_paper_id_papers"), nullable=False
    )
    relationship: Mapped[str] = mapped_column(String(16), nullable=False)
    evidence_kind: Mapped[str] = mapped_column(String(12), nullable=False, default="quote")
    quoted_text: Mapped[str] = mapped_column(Text, nullable=False)
    section_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unverified")
    created_at: Mapped[datetime] = _ts()


class ResearchDecision(Base):
    """Append-only history: changing a decision creates a NEW row that points at the one it supersedes."""

    __tablename__ = "research_decisions"
    __table_args__ = (
        CheckConstraint(_in("status", DECISION_STATUSES), name="ck_research_decisions_status"),
        Index("ix_research_decisions_project", "project_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_research_decisions_project_id_projects"), nullable=False
    )
    supersedes_id: Mapped[int | None] = mapped_column(
        ForeignKey("research_decisions.id", ondelete="SET NULL", name="fk_research_decisions_supersedes_id"), nullable=True
    )
    decision_type: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts_upd()


class ResearchGap(Base):
    """A POTENTIAL gap. It stays `potential` until a researcher validates it; absence from the saved papers proves nothing."""

    __tablename__ = "research_gaps"
    __table_args__ = (
        CheckConstraint(_in("status", GAP_STATUSES), name="ck_research_gaps_status"),
        CheckConstraint(_in("gap_category", GAP_CATEGORIES), name="ck_research_gaps_category"),
        Index("ix_research_gaps_project", "project_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_research_gaps_project_id_projects"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    gap_category: Mapped[str] = mapped_column(String(32), nullable=False)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    researcher_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="potential")
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = _ts()
    updated_at: Mapped[datetime] = _ts_upd()


class MemoryEvent(Base):
    """Append-only audit log of everything that changed the memory (feeds "Memory history")."""

    __tablename__ = "memory_events"
    __table_args__ = (
        CheckConstraint("actor IN ('system', 'researcher')", name="ck_memory_events_actor"),
        Index("ix_memory_events_project_created", "project_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", name="fk_memory_events_project_id_projects"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(12), nullable=False)
    subject_type: Mapped[str | None] = mapped_column(String(24), nullable=True)  # entry | claim | evidence | decision | gap | memory
    subject_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # no FK: the log must outlive the row it describes
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = _ts()
