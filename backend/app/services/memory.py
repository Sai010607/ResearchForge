"""Project research memory: generation, idempotent rebuild, conflict detection and provenance.

Design rules (see LITERATURE.md / MEMORY.md):
  * Automatic entries are built ONLY from a paper's own stored metadata (title, abstract, keywords, source fields) using the
    deterministic extractors in `extraction.py`. No LLM. Each keeps its exact matched text, section and timestamp.
  * A rule match is never promoted to "verified": it stays `unverified` until a researcher confirms it.
  * Rebuild is idempotent: every entry has a stable content hash unique per project, so reprocessing a paper creates nothing new.
  * Researcher decisions win: confirmed / edited / rejected entries are never overwritten or deleted by a rebuild.
  * Contradicting findings are kept side by side and surfaced by `detect_conflicts`; nothing is merged or averaged.
"""
import hashlib
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ClaimEvidence, MemoryEntry, MemoryEvent, Paper, Project, ProjectMemory, ProjectPaper, ResearchClaim, ResearchDecision, ResearchGap,
)
from app.services import extraction

MAX_ENTRIES_PER_PROJECT = 5000
NOT_COMPARABLE = (
    "These values come from different papers. Metrics measured on different datasets, cohorts, validation schemes or metric definitions "
    "are not directly comparable; read each source sentence before drawing any conclusion."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def content_hash(memory_type: str, paper_id: int | None, field: str, content: str, origin: str = "auto") -> str:
    return hashlib.sha256(f"{origin}|{memory_type}|{paper_id or ''}|{field}|{norm(content)}".encode()).hexdigest()


def log(db: Session, project_id: int, event_type: str, actor: str, subject_type: str | None = None, subject_id: int | None = None,
        detail: dict[str, Any] | None = None) -> None:
    db.add(MemoryEvent(project_id=project_id, event_type=event_type, actor=actor, subject_type=subject_type, subject_id=subject_id, detail=detail or {}))


def ensure_memory(db: Session, project: Project) -> ProjectMemory:
    mem = db.scalar(select(ProjectMemory).where(ProjectMemory.project_id == project.id))
    if mem is None:
        try:
            with db.begin_nested():
                mem = ProjectMemory(project_id=project.id)
                db.add(mem)
                db.flush()
        except IntegrityError:  # concurrent first access created it
            mem = db.scalar(select(ProjectMemory).where(ProjectMemory.project_id == project.id))
        else:
            log(db, project.id, "memory_created", "system", "memory", mem.id)
    assert mem is not None
    return mem


# ------------------------------------------------------------------------------------------------- candidates
def _entry(memory_type: str, paper_id: int | None, field: str, title: str, content: str, *, source_type: str, verification: str,
           source_reference: str | None = None, method: str | None = None, matched: str | None = None, section: str | None = None) -> dict[str, Any]:
    return {
        "memory_type": memory_type, "paper_id": paper_id, "field": field, "title": title[:300], "content": content, "origin": "auto",
        "source_type": source_type, "verification_status": verification, "source_reference": source_reference, "extraction_method": method,
        "matched_text": matched, "section_name": section, "content_hash": content_hash(memory_type, paper_id, field, content),
    }


def identity_candidates(project: Project) -> list[dict[str, Any]]:
    ref = f"project #{project.id} record entered by the researcher"
    rows = [("research_question", "Research question", project.research_question), ("disease", "Disease / domain", project.disease),
            ("modality", "Imaging modality", project.modality)]
    rows += [("objective", "Research objective", o) for o in project.objectives]
    return [_entry("research_identity", None, f, f"{t}: {v}"[:300], v, source_type="researcher_entered", verification="confirmed", source_reference=ref)
            for f, t, v in rows]


def paper_label(paper: Paper) -> str:
    return f"doi:{paper.doi}" if paper.doi else f"pmid:{paper.pmid}" if paper.pmid else f"{paper.source}:{paper.external_id}"


def paper_candidates(paper: Paper) -> list[dict[str, Any]]:
    """Everything that can be said about one paper from its OWN stored record, each with where it came from."""
    label = paper_label(paper)
    out: list[dict[str, Any]] = []
    for field, value in (("publication_type", paper.publication_type), ("venue", paper.venue), ("year", paper.year)):
        if value:
            out.append(_entry("literature", paper.id, field, f"{field.replace('_', ' ').capitalize()}: {value}", str(value), source_type="source_metadata",
                              verification="source_reported", source_reference=f"{paper.source} record of {label}"))
    ex = paper.extracted or {}
    tags = (("modality", "modalities"), ("disease", "diseases"), ("dataset", "datasets"), ("method", "methods"))
    for field, key in tags:
        for t in ex.get(key, []):
            out.append(_entry("literature", paper.id, field, f"{field.capitalize()}: {t['value']}", t["value"], source_type="rule_extracted",
                              verification="unverified", source_reference=f"{t['field']} of {label}", method=ex.get("method") or extraction.METHOD,
                              matched=t["matched"], section=t["field"]))
    for s in extraction.extract_sample_sizes(paper.title, paper.abstract):
        content = f"{s['value']} {s['unit']}" if s["unit"] else f"n = {s['value']}"
        out.append(_entry("literature", paper.id, "sample_size", f"Sample size: {content}", content, source_type="rule_extracted", verification="unverified",
                          source_reference=f"{s['field']} of {label}", method=extraction.NUMERIC_METHOD, matched=s["sentence"], section=s["field"]))
    for m in extraction.extract_reported_metrics(paper.title, paper.abstract):
        content = f"{m['metric']} {m['value']}{m['unit'] or ''}"
        out.append(_entry("literature", paper.id, "metric", f"Reported {m['metric']}: {m['value']}{m['unit'] or ''}", content, source_type="rule_extracted",
                          verification="unverified", source_reference=f"{m['field']} of {label}", method=extraction.NUMERIC_METHOD, matched=m["sentence"],
                          section=m["field"]))
    return out


# ------------------------------------------------------------------------------------------------- generation
def _insert_missing(db: Session, project_id: int, candidates: list[dict[str, Any]]) -> int:
    existing = set(db.scalars(select(MemoryEntry.content_hash).where(MemoryEntry.project_id == project_id)))
    total = len(existing)
    created = 0
    now = _now()
    for c in candidates:
        if c["content_hash"] in existing:
            continue
        if total + created >= MAX_ENTRIES_PER_PROJECT:
            break
        try:
            with db.begin_nested():
                db.add(MemoryEntry(project_id=project_id, extracted_at=now if c["source_type"] != "researcher_entered" else None, **c))
                db.flush()
        except IntegrityError:  # another request inserted the same hash first: that is exactly "no duplicate"
            continue
        existing.add(c["content_hash"])
        created += 1
    return created


def on_paper_saved(db: Session, project: Project, paper: Paper) -> int:
    """Called after a paper is saved. Idempotent; the caller must not let a failure here undo the save."""
    ensure_memory(db, project)
    created = _insert_missing(db, project.id, identity_candidates(project) + paper_candidates(paper))
    log(db, project.id, "paper_processed", "system", "memory", None, {"paper_id": paper.id, "entries_created": created})
    return created


def on_paper_removed(db: Session, project_id: int, paper_id: int) -> int:
    """Drop UNREVIEWED automatic entries of a paper that left the project. Anything a researcher touched is kept."""
    res = db.execute(delete(MemoryEntry).where(MemoryEntry.project_id == project_id, MemoryEntry.paper_id == paper_id,
                                               MemoryEntry.origin == "auto", MemoryEntry.reviewed_at.is_(None)))
    removed = res.rowcount or 0
    log(db, project_id, "paper_removed", "system", "memory", None, {"paper_id": paper_id, "unreviewed_entries_removed": removed})
    return removed


def project_papers(db: Session, project_id: int) -> list[Paper]:
    return list(db.scalars(select(Paper).join(ProjectPaper, ProjectPaper.paper_id == Paper.id).where(ProjectPaper.project_id == project_id).order_by(Paper.id)))


def rebuild(db: Session, project: Project) -> dict[str, Any]:
    """Regenerate automatic entries from the project record and its saved papers. Safe to run repeatedly."""
    mem = ensure_memory(db, project)
    candidates = identity_candidates(project)
    papers = project_papers(db, project.id)
    for p in papers:
        candidates += paper_candidates(p)
    fresh = {c["content_hash"] for c in candidates}
    created = _insert_missing(db, project.id, candidates)
    stale = list(db.scalars(select(MemoryEntry).where(MemoryEntry.project_id == project.id, MemoryEntry.origin == "auto",
                                                      MemoryEntry.reviewed_at.is_(None), MemoryEntry.content_hash.not_in(fresh or {""}))))
    for e in stale:
        db.delete(e)
    mem.version += 1
    mem.last_rebuilt_at = _now()
    counts = counts_for(db, project.id)
    mem.summary = (f"{len(papers)} saved paper(s); {counts['entries']} memory entries ({counts['by_source']['rule_extracted']} rule-extracted, "
                   f"{counts['by_source']['source_metadata']} from source metadata, {counts['confirmed']} confirmed by the researcher); "
                   f"{counts['claims']} claim(s), {counts['evidence']} evidence link(s).")
    log(db, project.id, "rebuilt", "system", "memory", mem.id, {"created": created, "removed_stale": len(stale), "papers": len(papers), "version": mem.version})
    return {"created": created, "removed_stale": len(stale), "papers_processed": len(papers), "version": mem.version}


def counts_for(db: Session, project_id: int) -> dict[str, Any]:
    def n(model, *where) -> int:
        return db.scalar(select(func.count()).select_from(model).where(model.project_id == project_id, *where)) or 0

    by_source = {s: n(MemoryEntry, MemoryEntry.source_type == s) for s in ("source_metadata", "rule_extracted", "ai_extracted", "researcher_confirmed", "researcher_entered")}
    evidence = db.scalar(select(func.count()).select_from(ClaimEvidence).join(ResearchClaim, ResearchClaim.id == ClaimEvidence.claim_id)
                         .where(ResearchClaim.project_id == project_id)) or 0
    return {
        "entries": n(MemoryEntry), "by_source": by_source,
        "confirmed": n(MemoryEntry, MemoryEntry.verification_status.in_(("confirmed", "edited")), MemoryEntry.origin == "auto", MemoryEntry.reviewed_at.is_not(None))
                     + n(MemoryEntry, MemoryEntry.origin == "researcher", MemoryEntry.verification_status != "rejected"),
        "unverified": n(MemoryEntry, MemoryEntry.verification_status == "unverified"),
        "rejected": n(MemoryEntry, MemoryEntry.verification_status == "rejected"),
        "claims": n(ResearchClaim), "evidence": evidence, "decisions": n(ResearchDecision), "gaps": n(ResearchGap),
        "saved_papers": db.scalar(select(func.count()).select_from(ProjectPaper).where(ProjectPaper.project_id == project_id)) or 0,
    }


# ------------------------------------------------------------------------------------------------- evidence
def check_quote(paper: Paper, quote: str) -> str:
    """'source_matched' when the quote literally occurs in the paper's stored title/abstract. Full text is not stored, so anything
    else stays 'unverified' (never silently accepted as a verified source passage)."""
    q = norm(quote)
    haystack = norm(f"{paper.title} {paper.abstract or ''}")
    return "source_matched" if q and q in haystack else "unverified"


# ------------------------------------------------------------------------------------------------- conflicts
def detect_conflicts(db: Session, project_id: int) -> list[dict[str, Any]]:
    """Both sides are always returned. Conflicts are surfaced, never resolved."""
    out: list[dict[str, Any]] = []
    rows = db.execute(select(ClaimEvidence, ResearchClaim, Paper).join(ResearchClaim, ResearchClaim.id == ClaimEvidence.claim_id)
                      .join(Paper, Paper.id == ClaimEvidence.paper_id)
                      .where(ResearchClaim.project_id == project_id, ResearchClaim.status == "active")).all()
    by_claim: dict[int, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    claims: dict[int, ResearchClaim] = {}
    for ev, claim, paper in rows:
        claims[claim.id] = claim
        by_claim[claim.id][ev.relationship].append({"evidence_id": ev.id, "paper_id": paper.id, "paper": paper.title, "quoted_text": ev.quoted_text,
                                                    "verification_status": ev.verification_status})
    for cid, rel in by_claim.items():
        if rel.get("supports") and rel.get("contradicts"):
            out.append({"kind": "contested_claim", "claim_id": cid, "claim_text": claims[cid].claim_text, "supports": rel["supports"],
                        "contradicts": rel["contradicts"], "note": "Supporting and contradicting evidence are both retained."})
    metrics = db.execute(select(MemoryEntry, Paper).join(Paper, Paper.id == MemoryEntry.paper_id).where(
        MemoryEntry.project_id == project_id, MemoryEntry.field == "metric", MemoryEntry.verification_status != "rejected")).all()
    by_metric: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e, paper in metrics:
        name = e.content.split(" ", 1)[0] if e.content else "metric"
        datasets = [t["value"] for t in (paper.extracted or {}).get("datasets", [])]
        by_metric[name].append({"entry_id": e.id, "paper_id": paper.id, "paper": paper.title, "value": e.content, "source_sentence": e.matched_text,
                                "datasets_named_in_paper": datasets})
    for name, items in by_metric.items():
        if len({i["value"] for i in items}) > 1 and len({i["paper_id"] for i in items}) > 1:
            out.append({"kind": "metric_variation", "metric": name, "values": items, "note": NOT_COMPARABLE})
    return out


# ------------------------------------------------------------------------------------------------- graph
def graph_edges(db: Session, project: Project) -> dict[str, Any]:
    """Provenance-tagged relationships for the knowledge graph. Every edge says HOW it is known; unsupported links are never invented."""
    edges: list[dict[str, Any]] = []
    papers = project_papers(db, project.id)
    ids = {p.id for p in papers}
    for p in papers:
        edges.append({"source": f"project:{project.id}", "target": f"paper:{p.id}", "relation": "saved_paper", "provenance": "source_verified",
                      "detail": f"saved from {p.source}"})
    by_ext = {p.external_id: p.id for p in papers if p.source == "openalex"}
    for p in papers:
        for ref in p.reference_ids or []:
            if ref in by_ext and by_ext[ref] != p.id:
                edges.append({"source": f"paper:{p.id}", "target": f"paper:{by_ext[ref]}", "relation": "cites", "provenance": "source_verified",
                              "detail": "OpenAlex reference list; a citation does not imply the cited work supports the claim"})
    for e in db.scalars(select(MemoryEntry).where(MemoryEntry.project_id == project.id, MemoryEntry.paper_id.is_not(None),
                                                  MemoryEntry.field.in_(("modality", "disease", "dataset", "method")), MemoryEntry.verification_status != "rejected")):
        if e.paper_id in ids:
            prov = "researcher_confirmed" if e.verification_status in ("confirmed", "edited") else "rule_extracted"
            edges.append({"source": f"paper:{e.paper_id}", "target": f"{e.field}:{e.content}", "relation": e.field, "provenance": prov,
                          "detail": e.matched_text and f"matched “{e.matched_text}” in {e.section_name}"})
    for ev, claim in db.execute(select(ClaimEvidence, ResearchClaim).join(ResearchClaim, ResearchClaim.id == ClaimEvidence.claim_id)
                                .where(ResearchClaim.project_id == project.id)).all():
        edges.append({"source": f"claim:{claim.id}", "target": f"paper:{ev.paper_id}", "relation": ev.relationship, "provenance":
                      "researcher_confirmed" if ev.verification_status == "confirmed" else "researcher_entered", "detail": f"quote {ev.verification_status}"})
    for g in db.scalars(select(ResearchGap).where(ResearchGap.project_id == project.id)):
        edges.append({"source": f"project:{project.id}", "target": f"gap:{g.id}", "relation": "potential_gap" if g.status == "potential" else g.status,
                      "provenance": "researcher_entered", "detail": "not proof of novelty"})
    for d in db.scalars(select(ResearchDecision).where(ResearchDecision.project_id == project.id)):
        edges.append({"source": f"project:{project.id}", "target": f"decision:{d.id}", "relation": d.decision_type, "provenance": "researcher_entered", "detail": d.status})
    return {"project_id": project.id, "synthetic": False, "edges": edges}
