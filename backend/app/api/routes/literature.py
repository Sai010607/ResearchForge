"""Literature search and per-project reading lists.

- Search is read-only against public sources; any signed-in user or active guest may use it
  (rate-limited per identity).
- Saving/listing/removing papers is authorised through PROJECT ownership, exactly like projects:
  another user's project (or a paper only they saved) is a 404, never visible.
- The client only names a paper (source + id). The server fetches it, so stored data is always
  what the source returned.
"""
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Identity, require_identity
from app.api.routes.projects import _get_owned_or_404, _owned_filter
from app.core import rate_limit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import api_error
from app.models import Paper, Project, ProjectPaper
from app.schemas.paper import PaperRead, ProviderInfo, SavePaper, SearchResponse, VerifyResponse
from app.services import discovery, literature, verify
from app.services.extraction import extract_metadata

router = APIRouter(tags=["literature"])


def _identity_key(identity: Identity) -> str:
    return f"u{identity.user.id}" if identity.user else f"g{identity.guest.id}"  # type: ignore[union-attr]


def _hit(p: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in p.items() if k != "reference_ids"}
    out["extracted"] = extract_metadata(p["title"], p.get("abstract"), p.get("keywords") or [])
    return out


@router.get("/api/literature/providers", response_model=list[ProviderInfo])
def list_providers(identity: Identity = Depends(require_identity)) -> list[dict[str, Any]]:
    """The provider registry. Never includes key values, only whether an optional key is configured."""
    return discovery.registry()


@router.get("/api/literature/search", response_model=SearchResponse)
def search_literature(
    q: str = Query(min_length=3, max_length=200),
    providers: str | None = Query(None, max_length=200, description="comma-separated provider ids; default = all default providers"),
    source: str = Query("all", max_length=20, description="legacy: 'all' or a single provider id"),
    page: int = Query(1, ge=1, le=20),
    identity: Identity = Depends(require_identity),
) -> dict[str, Any]:
    if providers:
        ids = list(dict.fromkeys(i.strip() for i in providers.split(",") if i.strip()))
    elif source != "all":
        ids = [source]
    else:
        ids = discovery.default_provider_ids()
    unknown = [i for i in ids if i not in discovery.BY_ID]
    if unknown or not ids:
        raise api_error(422, "unknown_provider", f"Unknown provider: {', '.join(unknown) or 'none selected'}")
    rate_limit.check("lit-search", _identity_key(identity), get_settings().literature_searches_per_hour, 3600)
    try:
        out = discovery.search_all(q.strip(), ids, page)
    except literature.LiteratureError as exc:
        raise api_error(502, "literature_unavailable", str(exc))
    out["results"] = [_hit(p) for p in out["results"]]
    return {"query": q.strip(), "source": ",".join(ids), "page": page, **out}


@router.get("/api/literature/verify", response_model=VerifyResponse)
def verify_paper(
    source: str = Query(max_length=20),
    external_id: str = Query(min_length=3, max_length=200),
    identity: Identity = Depends(require_identity),
) -> dict[str, Any]:
    """Deep identifier check: re-fetch the record from its provider, then ask each identifier's registry about it
    (Crossref for the DOI, PubMed for the PMID, the NCBI ID converter for PMCID<->PMID<->DOI, arXiv for the arXiv id)."""
    if source not in discovery.BY_ID:
        raise api_error(422, "unknown_provider", f"Unknown provider: {source}")
    rate_limit.check("lit-verify", _identity_key(identity), 60, 3600)
    try:
        paper = discovery.fetch_paper(source, external_id)
    except literature.PaperNotFound as exc:
        raise api_error(404, "paper_not_found", str(exc))
    except literature.LiteratureError as exc:
        raise api_error(502, "literature_unavailable", str(exc))
    return {"source": source, "external_id": external_id, **verify.check_identifiers(paper)}


def _upsert_paper(db: Session, data: dict[str, Any]) -> Paper:
    def find() -> Paper | None:
        paper = db.scalar(select(Paper).where(Paper.source == data["source"], Paper.external_id == data["external_id"]))
        if paper is None and data.get("doi"):
            paper = db.scalar(select(Paper).where(Paper.doi == data["doi"]))
        return paper

    paper = find()
    if paper is not None:
        return paper
    extracted = extract_metadata(data["title"], data.get("abstract"), data.get("keywords") or [])
    columns = {c.name for c in Paper.__table__.columns} - {"id", "fetched_at", "extracted"}
    fields = {k: v for k, v in data.items() if k in columns}  # search-only fields (links, relevance, verification...) are never stored
    paper = Paper(**fields, extracted=extracted)
    db.add(paper)
    try:
        db.flush()
    except IntegrityError:  # a concurrent request saved the same paper first
        db.rollback()
        paper = find()
        if paper is None:
            raise
    return paper


def _to_read(p: Paper, project_ids: list[int], cites: list[int]) -> dict[str, Any]:
    links = discovery.build_links({"source": p.source, "external_id": p.external_id, "doi": p.doi, "pmid": p.pmid, "pmcid": p.pmcid,
                                   "arxiv_id": p.arxiv_id, "publisher_url": p.publisher_url, "oa_url": p.oa_url})
    return {
        "id": p.id, "source": p.source, "external_id": p.external_id, "doi": p.doi, "pmid": p.pmid, "pmcid": p.pmcid,
        "arxiv_id": p.arxiv_id, "publisher_url": p.publisher_url, "oa_url": p.oa_url, "publication_type": p.publication_type,
        "preprint": p.publication_type == "preprint", "links": links, "primary_link": discovery.primary_link(links, p.publication_type),
        "title": p.title, "abstract": p.abstract, "year": p.year, "venue": p.venue, "authors": p.authors,
        "url": p.url, "cited_by_count": p.cited_by_count, "keywords": p.keywords, "extracted": p.extracted,
        "project_ids": project_ids, "cites": cites,
    }


def _citation_links(papers: list[Paper]) -> dict[int, list[int]]:
    """paper id -> ids of OTHER papers in this set that it cites (known only via OpenAlex references)."""
    by_ext = {p.external_id: p.id for p in papers if p.source == "openalex"}
    return {p.id: sorted({by_ext[r] for r in p.reference_ids if r in by_ext and by_ext[r] != p.id}) for p in papers}


@router.post("/api/projects/{project_id}/papers", response_model=PaperRead)
def save_paper(
    project_id: int,
    payload: SavePaper,
    response: Response,
    identity: Identity = Depends(require_identity),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _get_owned_or_404(db, identity, project_id)
    rate_limit.check("lit-save", _identity_key(identity), 120, 3600)
    count = db.scalar(select(func.count()).select_from(ProjectPaper).where(ProjectPaper.project_id == project.id)) or 0
    s = get_settings()
    already = None
    existing = db.scalar(select(Paper).where(Paper.source == payload.source, Paper.external_id == payload.external_id))
    if existing is not None:
        already = db.get(ProjectPaper, (project.id, existing.id))
    if already is None and count >= s.max_papers_per_project:
        raise api_error(403, "paper_limit_reached", f"A project can hold up to {s.max_papers_per_project} papers.")
    if existing is None:
        try:
            data = discovery.fetch_paper(payload.source, payload.external_id)
        except literature.PaperNotFound as exc:
            raise api_error(404, "paper_not_found", str(exc))
        except literature.LiteratureError as exc:
            raise api_error(502, "literature_unavailable", str(exc))
        existing = _upsert_paper(db, data)
        already = db.get(ProjectPaper, (project.id, existing.id))
    if already is None:
        db.add(ProjectPaper(project_id=project.id, paper_id=existing.id))
        try:
            db.commit()
        except IntegrityError:  # double-click: the link already exists
            db.rollback()
        response.status_code = status.HTTP_201_CREATED
    return _to_read(existing, [project.id], [])


@router.get("/api/projects/{project_id}/papers", response_model=list[PaperRead])
def list_project_papers(
    project_id: int, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    project = _get_owned_or_404(db, identity, project_id)
    papers = list(
        db.scalars(
            select(Paper).join(ProjectPaper, ProjectPaper.paper_id == Paper.id)
            .where(ProjectPaper.project_id == project.id).order_by(ProjectPaper.added_at.desc(), Paper.id.desc())
        )
    )
    cites = _citation_links(papers)
    return [_to_read(p, [project.id], cites[p.id]) for p in papers]


@router.delete("/api/projects/{project_id}/papers/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_paper(
    project_id: int, paper_id: int, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)
) -> Response:
    project = _get_owned_or_404(db, identity, project_id)
    link = db.get(ProjectPaper, (project.id, paper_id))
    if link is None:
        raise api_error(404, "not_found", "Paper not found in this project")
    db.delete(link)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/papers/mine", response_model=list[PaperRead])
def my_papers(identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """Every paper saved in any of the caller's projects (feeds the dashboard and knowledge graph)."""
    rows = db.execute(
        select(Paper, ProjectPaper.project_id)
        .join(ProjectPaper, ProjectPaper.paper_id == Paper.id)
        .join(Project, Project.id == ProjectPaper.project_id)
        .where(_owned_filter(identity))
        .order_by(Paper.id)
    ).all()
    papers: dict[int, Paper] = {}
    projects: dict[int, list[int]] = {}
    for paper, pid in rows:
        papers[paper.id] = paper
        projects.setdefault(paper.id, []).append(pid)
    cites = _citation_links(list(papers.values()))
    return [_to_read(p, sorted(projects[p.id]), cites[p.id]) for p in papers.values()]
