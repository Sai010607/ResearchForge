"""Literature search and per-project reading lists.

- Search is read-only against public sources; any signed-in user or active guest may use it
  (rate-limited per identity).
- Saving/listing/removing papers is authorised through PROJECT ownership, exactly like projects:
  another user's project (or a paper only they saved) is a 404, never visible.
- The client only names a paper (source + id). The server fetches it, so stored data is always
  what the source returned.
"""
from typing import Any, Literal

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
from app.schemas.paper import PaperRead, SavePaper, SearchResponse
from app.services import literature
from app.services.extraction import extract_metadata

router = APIRouter(tags=["literature"])


def _identity_key(identity: Identity) -> str:
    return f"u{identity.user.id}" if identity.user else f"g{identity.guest.id}"  # type: ignore[union-attr]


def _hit(p: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in p.items() if k != "reference_ids"}
    out["extracted"] = extract_metadata(p["title"], p.get("abstract"), p.get("keywords") or [])
    return out


@router.get("/api/literature/search", response_model=SearchResponse)
def search_literature(
    q: str = Query(min_length=3, max_length=200),
    source: Literal["all", "openalex", "europepmc"] = "all",
    page: int = Query(1, ge=1, le=20),
    identity: Identity = Depends(require_identity),
) -> dict[str, Any]:
    rate_limit.check("lit-search", _identity_key(identity), get_settings().literature_searches_per_hour, 3600)
    try:
        results, warnings = literature.search(q.strip(), source, page)
    except literature.LiteratureError as exc:
        raise api_error(502, "literature_unavailable", str(exc))
    return {"query": q.strip(), "source": source, "page": page, "results": [_hit(p) for p in results], "warnings": warnings}


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
    paper = Paper(**data, extracted=extracted)
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
    return {
        "id": p.id, "source": p.source, "external_id": p.external_id, "doi": p.doi, "pmid": p.pmid,
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
            data = literature.fetch_paper(payload.source, payload.external_id)
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
