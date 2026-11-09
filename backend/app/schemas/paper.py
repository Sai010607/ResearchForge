from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceRef(BaseModel):
    provider: str
    external_id: str


class Link(BaseModel):
    kind: str
    label: str
    url: str


class ProviderStatus(BaseModel):
    provider: str
    name: str
    ok: bool
    count: int
    error: str | None = None
    error_kind: str | None = None  # "timeout" | "rate_limit" | "error"
    duration_ms: int


class ProviderInfo(BaseModel):
    id: str
    name: str
    group: str
    requires_key: bool
    supports_key: bool
    key_configured: bool
    default_enabled: bool
    supports_search: bool
    supports_full_text: bool
    rate_limit: str
    docs: str
    env_var: str | None = None


class PaperHit(BaseModel):
    """A search result straight from the source (not saved yet)."""

    source: str
    external_id: str
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    publisher_url: str | None = None
    title: str
    abstract: str | None = None
    year: int | None = None
    venue: str | None = None
    authors: list[str] = []
    url: str | None = None
    cited_by_count: int | None = None
    keywords: list[str] = []
    extracted: dict[str, Any] = {}
    arxiv_id: str | None = None
    sources: list[SourceRef] = []  # every provider record merged into this result
    preprint: bool = False
    links: list[Link] = []  # DOI / PubMed / PMC / arXiv / publisher / source pages, built from stored ids


class SearchResponse(BaseModel):
    query: str
    source: str
    page: int
    results: list[PaperHit]
    warnings: list[str] = []
    providers: list[ProviderStatus] = []
    total_unique: int = 0  # unique papers in THIS response after deduplication (not the sum of provider counts)
    duration_ms: int = 0


class SavePaper(BaseModel):
    """The client names a paper; the SERVER fetches it. Client-supplied titles are never stored."""

    source: Literal["openalex", "europepmc", "pubmed", "crossref", "arxiv", "semanticscholar", "springer"]
    external_id: str = Field(min_length=3, max_length=200)


class PaperRead(PaperHit):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_ids: list[int] = []
    cites: list[int] = []  # ids of other saved papers this one cites (OpenAlex reference lists)
