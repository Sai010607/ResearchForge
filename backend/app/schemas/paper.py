from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class PaperHit(BaseModel):
    """A search result straight from the source (not saved yet)."""

    source: str
    external_id: str
    doi: str | None = None
    pmid: str | None = None
    title: str
    abstract: str | None = None
    year: int | None = None
    venue: str | None = None
    authors: list[str] = []
    url: str | None = None
    cited_by_count: int | None = None
    keywords: list[str] = []
    extracted: dict[str, Any] = {}


class SearchResponse(BaseModel):
    query: str
    source: str
    page: int
    results: list[PaperHit]
    warnings: list[str] = []


class SavePaper(BaseModel):
    """The client names a paper; the SERVER fetches it. Client-supplied titles are never stored."""

    source: Literal["openalex", "europepmc"]
    external_id: str = Field(min_length=3, max_length=64)


class PaperRead(PaperHit):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_ids: list[int] = []
    cites: list[int] = []  # ids of other saved papers this one cites (OpenAlex reference lists)
