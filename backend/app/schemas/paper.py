from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceRef(BaseModel):
    provider: str
    external_id: str


class Link(BaseModel):
    kind: str
    label: str
    url: str


class PrimaryLink(BaseModel):
    kind: str
    label: str
    url: str
    access: str  # "full_text" | "publisher" | "abstract" | "record"


class Check(BaseModel):
    id: str
    status: str  # pass | warn | fail | info
    detail: str


class Verification(BaseModel):
    """Agreement between the provider records merged into one result (no extra network calls)."""

    status: str  # cross_checked | single_source | warning | conflict
    sources_agreeing: int = 1
    checks: list[Check] = []


class MatchInfo(BaseModel):
    terms: int = 0
    terms_found: int = 0
    missing_terms: list[str] = []
    in_title: int = 0
    exact_title: bool = False
    phrase_found: bool = True


class ProviderStatus(BaseModel):
    provider: str
    name: str
    ok: bool
    count: int
    error: str | None = None
    error_kind: str | None = None  # "timeout" | "rate_limit" | "error"
    duration_ms: int
    requests: int = 0  # HTTP requests this provider made for the search (0 when answered from a test double)
    retries: int = 0  # how many of them were automatic retries


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
    primary_link: PrimaryLink | None = None  # the one "open" action: free full text first, then publisher, then abstract/record pages
    oa_url: str | None = None  # open-access full-text URL supplied by a source (OpenAlex, Semantic Scholar, Springer OA)
    publication_type: str | None = None  # journal_article | review | conference_paper | book_chapter | book | preprint | other | unknown
    relevance: float | None = None  # unified 0..1 score of this result for the query (search results only)
    match: MatchInfo | None = None
    verification: Verification | None = None


class SearchResponse(BaseModel):
    query: str
    source: str
    page: int
    results: list[PaperHit]
    warnings: list[str] = []
    providers: list[ProviderStatus] = []
    total_unique: int = 0  # unique papers in THIS response after deduplication (not the sum of provider counts)
    duration_ms: int = 0


class VerifyResponse(BaseModel):
    """Result of asking each identifier's authoritative registry about a paper (Crossref, PubMed, NCBI ID converter, arXiv)."""

    source: str
    external_id: str
    status: str  # verified | warning | conflict | unchecked
    checks: list[Check] = []


class SavePaper(BaseModel):
    """The client names a paper; the SERVER fetches it. Client-supplied titles are never stored."""

    source: Literal["openalex", "europepmc", "pubmed", "crossref", "arxiv", "semanticscholar", "springer"]
    external_id: str = Field(min_length=3, max_length=200)


class PaperRead(PaperHit):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_ids: list[int] = []
    cites: list[int] = []  # ids of other saved papers this one cites (OpenAlex reference lists)
