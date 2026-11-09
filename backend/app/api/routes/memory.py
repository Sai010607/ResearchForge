"""Project research memory API. Every route is authorised through PROJECT ownership (another user's project is a 404),
validated by Pydantic, rate-limited for writes, and every change is written to the audit log in the same transaction."""
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Identity, require_identity
from app.api.routes.projects import _get_owned_or_404
from app.core import rate_limit
from app.core.database import get_db
from app.core.errors import api_error
from app.models import (
    ClaimEvidence, MemoryEntry, MemoryEvent, Paper, Project, ProjectMemory, ProjectPaper, ResearchClaim, ResearchDecision, ResearchGap,
)
from app.schemas import memory as S
from app.services import memory as svc

router = APIRouter(prefix="/api/projects/{project_id}/memory", tags=["memory"])

NOTICE = ("Entries marked rule_extracted are keyword/regex matches on titles and abstracts, not verified findings. Abstracts are not full text, "
          "gaps are potential until you validate them, and citations never imply support.")
NOT_EXTRACTED = ["research_objective", "study_population", "preprocessing", "feature_extraction", "training_strategy", "validation_strategy",
                 "main_findings", "limitations", "future_research"]  # no extractor exists for these yet: they stay MISSING unless a researcher adds them
MANUAL_FIELDS = {
    "research_identity": set(S.IdentityField.__args__), "experiment_context": set(S.ExperimentField.__args__), "literature": set(S.LiteratureField.__args__),
}
TITLES = {"assumption": "Assumption", "scope": "Scope", "study_focus": "Study focus", "note": "Note"}


def _project(db: Session, identity: Identity, project_id: int) -> Project:
    return _get_owned_or_404(db, identity, project_id)


def _write_limit(identity: Identity) -> None:
    key = f"u{identity.user.id}" if identity.user else f"g{identity.guest.id}"  # type: ignore[union-attr]
    rate_limit.check("memory-write", key, 300, 3600)


def _paper_info(paper: Paper | None, in_project: bool) -> dict[str, Any] | None:
    if paper is None:
        return None
    return {"id": paper.id, "title": paper.title, "doi": paper.doi, "pmid": paper.pmid, "pmcid": paper.pmcid, "source": paper.source, "year": paper.year,
            "in_project": in_project, "url": paper.url}


def _in_project_ids(db: Session, project_id: int) -> set[int]:
    return set(db.scalars(select(ProjectPaper.paper_id).where(ProjectPaper.project_id == project_id)))


def _entry_out(e: MemoryEntry, papers: dict[int, Paper], member: set[int]) -> S.EntryRead:
    out = S.EntryRead.model_validate(e)
    out.paper = _paper_info(papers.get(e.paper_id) if e.paper_id else None, e.paper_id in member if e.paper_id else False)
    return out


def _require_project_paper(db: Session, project_id: int, paper_id: int) -> Paper:
    paper = db.scalar(select(Paper).join(ProjectPaper, ProjectPaper.paper_id == Paper.id).where(ProjectPaper.project_id == project_id, Paper.id == paper_id))
    if paper is None:
        raise api_error(422, "paper_not_in_project", "That paper is not saved in this project.")
    return paper


def _get_in(db: Session, model, project_id: int, obj_id: int, what: str):
    obj = db.scalar(select(model).where(model.id == obj_id, model.project_id == project_id))
    if obj is None:
        raise api_error(404, "not_found", f"{what} not found")
    return obj


# ------------------------------------------------------------------------------------------------- overview / rebuild / audit
@router.get("", response_model=S.MemoryOverview)
def overview(project_id: int, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    mem = db.scalar(select(ProjectMemory).where(ProjectMemory.project_id == project.id))
    last = db.scalar(select(func.max(MemoryEvent.created_at)).where(MemoryEvent.project_id == project.id))
    return {
        "project_id": project.id, "research_question": project.research_question, "disease": project.disease, "modality": project.modality,
        "objectives": list(project.objectives), "version": mem.version if mem else 0, "summary": mem.summary if mem else None,
        "last_rebuilt_at": mem.last_rebuilt_at if mem else None, "last_updated_at": last, "counts": svc.counts_for(db, project.id),
        "conflicts": svc.detect_conflicts(db, project.id), "not_extracted": NOT_EXTRACTED, "notice": NOTICE,
    }


@router.post("/rebuild", response_model=S.RebuildResult)
def rebuild(project_id: int, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    rate_limit.check("memory-rebuild", f"p{project.id}", 30, 3600)
    result = svc.rebuild(db, project)
    db.commit()
    return result


@router.get("/audit", response_model=S.EventPage)
def audit(project_id: int, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), identity: Identity = Depends(require_identity),
          db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    total = db.scalar(select(func.count()).select_from(MemoryEvent).where(MemoryEvent.project_id == project.id)) or 0
    items = list(db.scalars(select(MemoryEvent).where(MemoryEvent.project_id == project.id).order_by(MemoryEvent.id.desc()).limit(limit).offset(offset)))
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/graph")
def graph(project_id: int, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Provenance-tagged edges for the knowledge graph (not yet drawn by the 3D view; see MEMORY.md)."""
    return svc.graph_edges(db, _project(db, identity, project_id))


# ------------------------------------------------------------------------------------------------- entries
@router.get("/entries", response_model=S.EntryPage)
def list_entries(
    project_id: int, memory_type: str | None = Query(None, max_length=24), field: str | None = Query(None, max_length=40),
    verification_status: str | None = Query(None, max_length=16), source_type: str | None = Query(None, max_length=24),
    paper_id: int | None = None, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    identity: Identity = Depends(require_identity), db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    conds = [MemoryEntry.project_id == project.id]
    for col, val in ((MemoryEntry.memory_type, memory_type), (MemoryEntry.field, field), (MemoryEntry.verification_status, verification_status),
                     (MemoryEntry.source_type, source_type), (MemoryEntry.paper_id, paper_id)):
        if val is not None:
            conds.append(col == val)
    total = db.scalar(select(func.count()).select_from(MemoryEntry).where(*conds)) or 0
    rows = list(db.scalars(select(MemoryEntry).where(*conds).order_by(MemoryEntry.paper_id.nulls_first(), MemoryEntry.id).limit(limit).offset(offset)))
    papers = {p.id: p for p in db.scalars(select(Paper).where(Paper.id.in_({r.paper_id for r in rows if r.paper_id})))} if rows else {}
    member = _in_project_ids(db, project.id)
    return {"total": total, "limit": limit, "offset": offset, "items": [_entry_out(r, papers, member) for r in rows]}


@router.post("", response_model=S.EntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(project_id: int, payload: S.EntryCreate, response: Response, identity: Identity = Depends(require_identity),
                 db: Session = Depends(get_db)) -> S.EntryRead:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    if payload.field not in MANUAL_FIELDS[payload.memory_type]:
        raise api_error(422, "invalid_field", f"field must be one of: {', '.join(sorted(MANUAL_FIELDS[payload.memory_type]))}")
    paper = None
    if payload.paper_id is not None:
        paper = _require_project_paper(db, project.id, payload.paper_id)
    elif payload.memory_type == "literature":
        raise api_error(422, "paper_required", "Literature notes must reference a saved paper.")
    svc.ensure_memory(db, project)
    if (db.scalar(select(func.count()).select_from(MemoryEntry).where(MemoryEntry.project_id == project.id)) or 0) >= svc.MAX_ENTRIES_PER_PROJECT:
        raise api_error(403, "memory_limit_reached", "This project's memory is full.")
    h = svc.content_hash(payload.memory_type, payload.paper_id, payload.field, payload.content, "researcher")
    existing = db.scalar(select(MemoryEntry).where(MemoryEntry.project_id == project.id, MemoryEntry.content_hash == h))
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _entry_out(existing, {paper.id: paper} if paper else {}, _in_project_ids(db, project.id))
    title = f"{TITLES.get(payload.field, payload.field.replace('_', ' ').capitalize())}: {payload.content}"[:300]
    e = MemoryEntry(project_id=project.id, paper_id=payload.paper_id, memory_type=payload.memory_type, field=payload.field, title=title, content=payload.content,
                    origin="researcher", source_type="researcher_entered", verification_status="confirmed", source_reference=payload.source_reference
                    or "entered by the researcher", content_hash=h, reviewed_at=svc._now())
    db.add(e)
    db.flush()
    svc.log(db, project.id, "entry_created", "researcher", "entry", e.id, {"field": e.field, "memory_type": e.memory_type})
    db.commit()
    db.refresh(e)
    return _entry_out(e, {paper.id: paper} if paper else {}, _in_project_ids(db, project.id))


@router.patch("/entries/{entry_id}", response_model=S.EntryRead)
def patch_entry(project_id: int, entry_id: int, payload: S.EntryPatch, identity: Identity = Depends(require_identity),
                db: Session = Depends(get_db)) -> S.EntryRead:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    e: MemoryEntry = _get_in(db, MemoryEntry, project.id, entry_id, "Memory entry")
    before = {"content": e.content, "verification_status": e.verification_status, "source_type": e.source_type}
    events = []
    if payload.content is not None and payload.content != e.content:
        e.content = payload.content  # content_hash is deliberately unchanged: it is the identity of the AUTO entry, so a rebuild cannot re-create the original
        e.title = f"{e.field.replace('_', ' ').capitalize()}: {payload.content}"[:300]
        e.verification_status = "edited"
        e.source_type = "researcher_confirmed"
        events.append("entry_edited")
    if payload.verification_status is not None and "entry_edited" not in events:
        e.verification_status = payload.verification_status
        if payload.verification_status == "confirmed":
            e.source_type = "researcher_confirmed" if e.origin == "auto" else e.source_type
            events.append("entry_confirmed")
        elif payload.verification_status == "rejected":
            events.append("entry_rejected")
        else:
            events.append("entry_unverified")
    e.reviewed_at = svc._now()
    for ev in events:
        svc.log(db, project.id, ev, "researcher", "entry", e.id, {"before": before, "after": {"content": e.content, "verification_status": e.verification_status}})
    db.commit()
    db.refresh(e)
    paper = db.get(Paper, e.paper_id) if e.paper_id else None
    return _entry_out(e, {paper.id: paper} if paper else {}, _in_project_ids(db, project.id))


# ------------------------------------------------------------------------------------------------- claims
def _claim_out(db: Session, claim: ResearchClaim, member: set[int]) -> S.ClaimRead:
    evs = list(db.scalars(select(ClaimEvidence).where(ClaimEvidence.claim_id == claim.id).order_by(ClaimEvidence.id)))
    papers = {p.id: p for p in db.scalars(select(Paper).where(Paper.id.in_({e.paper_id for e in evs})))} if evs else {}
    out = S.ClaimRead.model_validate(claim)
    out.evidence = []
    for e in evs:
        er = S.EvidenceRead.model_validate(e)
        er.paper = _paper_info(papers.get(e.paper_id), e.paper_id in member)
        out.evidence.append(er)
    rels = {e.relationship for e in evs}
    out.contested = "supports" in rels and "contradicts" in rels
    return out


def _add_evidence(db: Session, project_id: int, claim: ResearchClaim, ev: S.EvidenceIn) -> ClaimEvidence:
    paper = _require_project_paper(db, project_id, ev.paper_id)
    verification = svc.check_quote(paper, ev.quoted_text) if ev.evidence_kind == "quote" else "unverified"
    row = ClaimEvidence(claim_id=claim.id, paper_id=paper.id, relationship=ev.relationship, evidence_kind=ev.evidence_kind, quoted_text=ev.quoted_text,
                        section_name=ev.section_name, page_number=ev.page_number, source_url=ev.source_url, verification_status=verification)
    db.add(row)
    db.flush()
    svc.log(db, project_id, "evidence_added", "researcher", "evidence", row.id, {"claim_id": claim.id, "paper_id": paper.id, "relationship": ev.relationship,
                                                                               "verification_status": verification})
    return row


@router.get("/claims", response_model=S.ClaimPage)
def list_claims(project_id: int, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), identity: Identity = Depends(require_identity),
                db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    total = db.scalar(select(func.count()).select_from(ResearchClaim).where(ResearchClaim.project_id == project.id)) or 0
    rows = list(db.scalars(select(ResearchClaim).where(ResearchClaim.project_id == project.id).order_by(ResearchClaim.id.desc()).limit(limit).offset(offset)))
    member = _in_project_ids(db, project.id)
    return {"total": total, "limit": limit, "offset": offset, "items": [_claim_out(db, c, member) for c in rows]}


@router.post("/claims", response_model=S.ClaimRead, status_code=status.HTTP_201_CREATED)
def create_claim(project_id: int, payload: S.ClaimCreate, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> S.ClaimRead:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    svc.ensure_memory(db, project)
    claim = ResearchClaim(project_id=project.id, claim_text=payload.claim_text, claim_type=payload.claim_type, origin="researcher", confidence=payload.confidence)
    db.add(claim)
    db.flush()
    svc.log(db, project.id, "claim_added", "researcher", "claim", claim.id, {"claim_type": claim.claim_type})
    for ev in payload.evidence:
        _add_evidence(db, project.id, claim, ev)  # a 422 here rolls the whole claim back: no half-sourced claims
    db.commit()
    db.refresh(claim)
    return _claim_out(db, claim, _in_project_ids(db, project.id))


@router.post("/claims/{claim_id}/evidence", response_model=S.ClaimRead, status_code=status.HTTP_201_CREATED)
def add_evidence(project_id: int, claim_id: int, payload: S.EvidenceIn, identity: Identity = Depends(require_identity),
                 db: Session = Depends(get_db)) -> S.ClaimRead:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    claim = _get_in(db, ResearchClaim, project.id, claim_id, "Claim")
    _add_evidence(db, project.id, claim, payload)
    db.commit()
    return _claim_out(db, claim, _in_project_ids(db, project.id))


@router.patch("/claims/{claim_id}", response_model=S.ClaimRead)
def patch_claim(project_id: int, claim_id: int, payload: S.ClaimPatch, identity: Identity = Depends(require_identity),
                db: Session = Depends(get_db)) -> S.ClaimRead:
    project = _project(db, identity, project_id)
    claim = _get_in(db, ResearchClaim, project.id, claim_id, "Claim")
    if claim.status != payload.status:
        svc.log(db, project.id, "claim_status", "researcher", "claim", claim.id, {"from": claim.status, "to": payload.status})
        claim.status = payload.status  # retracting keeps the claim and its evidence: nothing is deleted
    db.commit()
    return _claim_out(db, claim, _in_project_ids(db, project.id))


# ------------------------------------------------------------------------------------------------- gaps
@router.get("/gaps", response_model=S.GapPage)
def list_gaps(project_id: int, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), identity: Identity = Depends(require_identity),
              db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    total = db.scalar(select(func.count()).select_from(ResearchGap).where(ResearchGap.project_id == project.id)) or 0
    items = list(db.scalars(select(ResearchGap).where(ResearchGap.project_id == project.id).order_by(ResearchGap.id.desc()).limit(limit).offset(offset)))
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.post("/gaps", response_model=S.GapRead, status_code=status.HTTP_201_CREATED)
def create_gap(project_id: int, payload: S.GapCreate, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> ResearchGap:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    svc.ensure_memory(db, project)
    gap = ResearchGap(project_id=project.id, status="potential", **payload.model_dump())  # always starts as "potential"
    db.add(gap)
    db.flush()
    svc.log(db, project.id, "gap_added", "researcher", "gap", gap.id, {"category": gap.gap_category})
    db.commit()
    db.refresh(gap)
    return gap


@router.patch("/gaps/{gap_id}", response_model=S.GapRead)
def patch_gap(project_id: int, gap_id: int, payload: S.GapPatch, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> ResearchGap:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    gap = _get_in(db, ResearchGap, project.id, gap_id, "Gap")
    changes = payload.model_dump(exclude_unset=True)
    svc.log(db, project.id, "gap_updated", "researcher", "gap", gap.id, {"before": {k: getattr(gap, k) for k in changes}, "after": changes})
    for k, v in changes.items():
        setattr(gap, k, v)
    db.commit()
    db.refresh(gap)
    return gap


# ------------------------------------------------------------------------------------------------- decisions
@router.get("/decisions", response_model=S.DecisionPage)
def list_decisions(project_id: int, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), identity: Identity = Depends(require_identity),
                   db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _project(db, identity, project_id)
    total = db.scalar(select(func.count()).select_from(ResearchDecision).where(ResearchDecision.project_id == project.id)) or 0
    items = list(db.scalars(select(ResearchDecision).where(ResearchDecision.project_id == project.id).order_by(ResearchDecision.id.desc()).limit(limit).offset(offset)))
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.post("/decisions", response_model=S.DecisionRead, status_code=status.HTTP_201_CREATED)
def create_decision(project_id: int, payload: S.DecisionCreate, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)) -> ResearchDecision:
    project = _project(db, identity, project_id)
    _write_limit(identity)
    svc.ensure_memory(db, project)
    if payload.supersedes_id is not None:
        old: ResearchDecision = _get_in(db, ResearchDecision, project.id, payload.supersedes_id, "Decision to supersede")
        if old.status == "superseded":
            raise api_error(409, "already_superseded", "That decision has already been superseded.")
        old.status = "superseded"  # history kept: the old row stays, linked from the new one
        svc.log(db, project.id, "decision_superseded", "researcher", "decision", old.id, {"by_new_decision": True})
    d = ResearchDecision(project_id=project.id, decision_type=payload.decision_type, description=payload.description, rationale=payload.rationale,
                         supersedes_id=payload.supersedes_id, status="active")
    db.add(d)
    db.flush()
    svc.log(db, project.id, "decision_recorded", "researcher", "decision", d.id, {"decision_type": d.decision_type, "supersedes_id": d.supersedes_id})
    db.commit()
    db.refresh(d)
    return d


@router.patch("/decisions/{decision_id}", response_model=S.DecisionRead)
def patch_decision(project_id: int, decision_id: int, payload: S.DecisionPatch, identity: Identity = Depends(require_identity),
                   db: Session = Depends(get_db)) -> ResearchDecision:
    project = _project(db, identity, project_id)
    d: ResearchDecision = _get_in(db, ResearchDecision, project.id, decision_id, "Decision")
    if d.status == "superseded":
        raise api_error(409, "already_superseded", "A superseded decision is history and cannot be changed; record a new decision instead.")
    if d.status != payload.status:
        svc.log(db, project.id, "decision_status", "researcher", "decision", d.id, {"from": d.status, "to": payload.status})
        d.status = payload.status
    db.commit()
    db.refresh(d)
    return d
