from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EvidenceRelationship = Literal["supports", "contradicts", "contextualizes", "neutral"]
ClaimType = Literal["finding", "hypothesis", "method", "background"]
GapCategory = Literal["methodological", "dataset", "population", "evaluation", "reproducibility", "conflicting_findings", "unanswered_question", "hypothesis_to_validate"]
DecisionType = Literal["method_selected", "method_rejected", "dataset_choice", "evaluation_strategy", "inclusion_exclusion", "scope_change", "other"]
ManualMemoryType = Literal["research_identity", "experiment_context", "literature"]
ExperimentField = Literal["objective", "dataset", "dataset_version", "model_configuration", "training_strategy", "evaluation_metrics", "results", "reproducibility_reference"]
IdentityField = Literal["assumption", "scope", "study_focus", "note"]
LiteratureField = Literal["note", "research_objective", "study_population", "preprocessing", "feature_extraction", "validation_strategy", "main_finding", "limitation", "future_research"]


def _text(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


class Page(BaseModel):
    total: int
    limit: int
    offset: int


class EntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    paper_id: int | None
    memory_type: str
    field: str
    title: str
    content: str
    origin: str
    source_type: str
    source_reference: str | None
    extraction_method: str | None
    matched_text: str | None
    section_name: str | None
    page_number: int | None
    extracted_at: datetime | None
    verification_status: str
    confidence: float | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    paper: dict[str, Any] | None = None  # {id,title,doi,pmid,source,in_project}


class EntryPage(Page):
    items: list[EntryRead]


class EntryCreate(BaseModel):
    """Researcher-supplied memory. `field` is validated per type in the route."""
    memory_type: ManualMemoryType
    field: str = Field(min_length=2, max_length=40)
    content: str = Field(min_length=1, max_length=4000)
    paper_id: int | None = None
    source_reference: str | None = Field(None, max_length=500)

    _c = field_validator("content")(_text)


class EntryPatch(BaseModel):
    verification_status: Literal["confirmed", "rejected", "unverified"] | None = None
    content: str | None = Field(None, min_length=1, max_length=4000)

    @model_validator(mode="after")
    def need_something(self) -> "EntryPatch":
        if self.verification_status is None and self.content is None:
            raise ValueError("Provide verification_status and/or content.")
        if self.content is not None:
            self.content = _text(self.content)
        return self


class EvidenceIn(BaseModel):
    paper_id: int
    relationship: EvidenceRelationship
    evidence_kind: Literal["quote", "paraphrase"] = "quote"
    quoted_text: str = Field(min_length=3, max_length=4000)
    section_name: str | None = Field(None, max_length=80)
    page_number: int | None = Field(None, ge=1, le=100000)
    source_url: str | None = Field(None, max_length=1000)

    _q = field_validator("quoted_text")(_text)

    @field_validator("source_url")
    @classmethod
    def http_only(cls, v: str | None) -> str | None:
        if v and not v.lower().startswith(("http://", "https://")):
            raise ValueError("source_url must be an http(s) URL")
        return v


class EvidenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    claim_id: int
    paper_id: int
    relationship: str
    evidence_kind: str
    quoted_text: str
    section_name: str | None
    page_number: int | None
    source_url: str | None
    verification_status: str
    created_at: datetime
    paper: dict[str, Any] | None = None


class ClaimCreate(BaseModel):
    claim_text: str = Field(min_length=5, max_length=2000)
    claim_type: ClaimType
    confidence: float | None = Field(None, ge=0, le=1)
    evidence: list[EvidenceIn] = Field(default_factory=list, max_length=20)

    _t = field_validator("claim_text")(_text)

    @model_validator(mode="after")
    def traceable(self) -> "ClaimCreate":
        if self.claim_type != "hypothesis" and not self.evidence:
            raise ValueError("A claim that is not marked as a hypothesis needs at least one source: attach evidence or set claim_type to 'hypothesis'.")
        return self


class ClaimPatch(BaseModel):
    status: Literal["active", "retracted"]


class ClaimRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    claim_text: str
    claim_type: str
    origin: str
    status: str
    confidence: float | None
    created_at: datetime
    updated_at: datetime
    evidence: list[EvidenceRead] = []
    contested: bool = False


class ClaimPage(Page):
    items: list[ClaimRead]


class GapCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(min_length=5, max_length=4000)
    gap_category: GapCategory
    evidence_summary: str | None = Field(None, max_length=4000)
    confidence: float | None = Field(None, ge=0, le=1)

    _t = field_validator("title", "description")(_text)


class GapPatch(BaseModel):
    status: Literal["potential", "validated", "dismissed"] | None = None
    researcher_comment: str | None = Field(None, max_length=4000)
    evidence_summary: str | None = Field(None, max_length=4000)

    @model_validator(mode="after")
    def need_something(self) -> "GapPatch":
        if not self.model_fields_set:
            raise ValueError("Nothing to update.")
        return self


class GapRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: str
    gap_category: str
    evidence_summary: str | None
    researcher_comment: str | None
    status: str
    confidence: float | None
    created_at: datetime
    updated_at: datetime
    notice: str = "Potential gap: absence from your saved papers is not proof of novelty until you validate it."


class GapPage(Page):
    items: list[GapRead]


class DecisionCreate(BaseModel):
    decision_type: DecisionType
    description: str = Field(min_length=3, max_length=4000)
    rationale: str | None = Field(None, max_length=4000)
    supersedes_id: int | None = None

    _d = field_validator("description")(_text)


class DecisionPatch(BaseModel):
    status: Literal["active", "rejected"]


class DecisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    supersedes_id: int | None
    decision_type: str
    description: str
    rationale: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class DecisionPage(Page):
    items: list[DecisionRead]


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_type: str
    actor: str
    subject_type: str | None
    subject_id: int | None
    detail: dict[str, Any]
    created_at: datetime


class EventPage(Page):
    items: list[EventRead]


class MemoryOverview(BaseModel):
    project_id: int
    research_question: str
    disease: str
    modality: str
    objectives: list[str]
    version: int
    summary: str | None
    last_rebuilt_at: datetime | None
    last_updated_at: datetime | None
    counts: dict[str, Any]
    conflicts: list[dict[str, Any]]
    not_extracted: list[str]
    notice: str


class RebuildResult(BaseModel):
    created: int
    removed_stale: int
    papers_processed: int
    version: int
