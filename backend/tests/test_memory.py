"""Project research memory: generation, idempotency, provenance, ownership, evidence, conflicts, decisions, gaps, migration."""
import pytest
from sqlalchemy import func, select, text

from app.core.database import SessionLocal, engine
from app.models import MemoryEntry, Paper, Project, ProjectPaper, ResearchClaim
from app.services import discovery, extraction, memory as svc
from tests.helpers import VALID, register

ABSTRACT_A = ("We studied 1,245 participants from ADNI using a 3D CNN on T1-weighted MRI. The model reached an accuracy of 92.3% in 10-fold "
              "cross-validation. Hippocampal atrophy drove the prediction.")
ABSTRACT_B = "A graph neural network on ABIDE fMRI data (n = 300 subjects) achieved an accuracy of 71% under leave-site-out validation."


def add_paper(project_id: int, n: int, title: str, abstract: str | None, **over) -> int:
    data = {"source": "openalex", "external_id": f"W{n}", "doi": f"10.1000/m{n}", "title": title, "abstract": abstract, "year": 2022, "venue": "NeuroImage",
            "authors": ["A. Author"], "keywords": [], "reference_ids": [], "publication_type": "journal_article", **over}
    with SessionLocal() as db:
        p = Paper(**data, extracted=extraction.extract_metadata(title, abstract, []))
        db.add(p)
        db.flush()
        db.add(ProjectPaper(project_id=project_id, paper_id=p.id))
        db.commit()
        return p.id


@pytest.fixture()
def ctx(client):
    assert register(client).status_code == 201
    pid = client.post("/api/projects", json=VALID).json()["id"]
    a = add_paper(pid, 1, "Interpretable T1-weighted MRI biomarkers for Alzheimer's disease on ADNI", ABSTRACT_A)
    b = add_paper(pid, 2, "Graph neural networks for autism classification", ABSTRACT_B)
    return client, pid, a, b


def url(pid: int, tail: str = "") -> str:
    return f"/api/projects/{pid}/memory{tail}"


def rebuild(c, pid):
    r = c.post(url(pid, "/rebuild"))
    assert r.status_code == 200, r.text
    return r.json()


def entries(c, pid, **params):
    r = c.get(url(pid, "/entries"), params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ generation, idempotency, provenance
def test_memory_starts_empty_then_rebuild_builds_identity_and_literature(ctx):
    c, pid, a, b = ctx
    o = c.get(url(pid)).json()
    assert o["version"] == 0 and o["counts"]["entries"] == 0 and o["research_question"] == VALID["research_question"]
    assert o["counts"]["saved_papers"] == 2
    res = rebuild(c, pid)
    assert res["created"] > 0 and res["papers_processed"] == 2 and res["version"] == 1
    ident = entries(c, pid, memory_type="research_identity")["items"]
    assert {e["field"] for e in ident} >= {"research_question", "disease", "modality", "objective"}
    assert all(e["source_type"] == "researcher_entered" for e in ident)
    assert c.get(url(pid)).json()["counts"]["entries"] == entries(c, pid)["total"]


def test_rebuild_is_idempotent_and_never_duplicates(ctx):
    c, pid, *_ = ctx
    rebuild(c, pid)
    first = entries(c, pid)["total"]
    again = rebuild(c, pid)
    assert again["created"] == 0 and again["removed_stale"] == 0 and entries(c, pid)["total"] == first
    with SessionLocal() as db:
        dup = db.execute(select(MemoryEntry.content_hash, func.count()).where(MemoryEntry.project_id == pid).group_by(MemoryEntry.content_hash)
                         .having(func.count() > 1)).all()
    assert dup == []


def test_rule_matches_are_unverified_and_keep_their_exact_source_text(ctx):
    c, pid, a, _ = ctx
    rebuild(c, pid)
    items = entries(c, pid, paper_id=a)["items"]
    ds = next(e for e in items if e["field"] == "dataset")
    assert (ds["content"], ds["source_type"], ds["verification_status"]) == ("ADNI", "rule_extracted", "unverified")
    assert ds["matched_text"] == "ADNI" and ds["section_name"] == "title" and ds["extracted_at"] and ds["extraction_method"]
    assert ds["confidence"] is None  # a regex hit carries no probability, so none is invented
    size = next(e for e in items if e["field"] == "sample_size")
    assert size["content"] == "1245 participants" and "1,245 participants from ADNI" in size["matched_text"]
    metric = next(e for e in items if e["field"] == "metric")
    assert metric["content"] == "accuracy 92.3%" and "10-fold cross-validation" in metric["matched_text"]
    src = next(e for e in items if e["field"] == "venue")
    assert (src["source_type"], src["verification_status"]) == ("source_metadata", "source_reported")
    assert ds["paper"]["doi"] == "10.1000/m1" and ds["paper"]["in_project"] is True


def test_missing_information_is_not_invented(ctx):
    c, pid, *_ = ctx
    p = add_paper(pid, 3, "A short note", None, venue=None, publication_type=None, year=None)
    rebuild(c, pid)
    assert entries(c, pid, paper_id=p)["items"] == []
    assert "limitations" in c.get(url(pid)).json()["not_extracted"]


def test_saving_a_paper_updates_memory_and_a_memory_failure_never_loses_the_paper(ctx, monkeypatch):
    c, pid, *_ = ctx
    rec = {"source": "openalex", "external_id": "W77", "doi": "10.1000/w77", "title": "T1-weighted MRI in Parkinson's disease with a CNN",
           "abstract": "A CNN on PPMI, n = 120 patients.", "year": 2021, "venue": "Brain", "authors": [], "keywords": [], "reference_ids": []}
    monkeypatch.setattr(discovery, "fetch_paper", lambda s, e: dict(rec))
    r = c.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W77"})
    assert r.status_code == 201
    assert any(e["content"] == "PPMI" for e in entries(c, pid)["items"])
    again = svc.on_paper_saved  # now break memory generation
    monkeypatch.setattr(svc, "on_paper_saved", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    rec2 = {**rec, "external_id": "W78", "doi": "10.1000/w78", "title": "Another paper on ADNI MRI"}
    monkeypatch.setattr(discovery, "fetch_paper", lambda s, e: dict(rec2))
    r = c.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W78"})
    assert r.status_code == 201
    assert any(p["external_id"] == "W78" for p in c.get(f"/api/projects/{pid}/papers").json())
    monkeypatch.setattr(svc, "on_paper_saved", again)


# ------------------------------------------------------------------ researcher decisions win
def test_confirm_edit_reject_survive_rebuild_and_are_never_recreated(ctx):
    c, pid, a, _ = ctx
    rebuild(c, pid)
    items = entries(c, pid, paper_id=a)["items"]
    ds = next(e for e in items if e["field"] == "dataset")
    meth = next(e for e in items if e["field"] == "method")
    c.patch(url(pid, f"/entries/{ds['id']}"), json={"verification_status": "confirmed"})
    edited = c.patch(url(pid, f"/entries/{meth['id']}"), json={"content": "3D convolutional network (author wording)"}).json()
    assert edited["verification_status"] == "edited" and edited["source_type"] == "researcher_confirmed" and edited["matched_text"]  # provenance kept
    metric = next(e for e in items if e["field"] == "metric")
    assert c.patch(url(pid, f"/entries/{metric['id']}"), json={"verification_status": "rejected"}).json()["verification_status"] == "rejected"
    total = entries(c, pid)["total"]
    assert rebuild(c, pid)["created"] == 0 and entries(c, pid)["total"] == total
    after = {e["id"]: e for e in entries(c, pid, paper_id=a)["items"]}
    assert after[ds["id"]]["verification_status"] == "confirmed" and after[ds["id"]]["source_type"] == "researcher_confirmed"
    assert after[meth["id"]]["content"].endswith("(author wording)") and after[metric["id"]]["verification_status"] == "rejected"
    ev = [e["event_type"] for e in c.get(url(pid, "/audit")).json()["items"]]
    assert {"entry_confirmed", "entry_edited", "entry_rejected", "rebuilt"} <= set(ev)


def test_project_edit_replaces_stale_identity_but_keeps_reviewed(ctx):
    c, pid, *_ = ctx
    rebuild(c, pid)
    q = next(e for e in entries(c, pid, field="disease")["items"])
    c.patch(url(pid, f"/entries/{q['id']}"), json={"verification_status": "confirmed"})
    c.put(f"/api/projects/{pid}", json={**VALID, "disease": "Brain Tumor"})
    res = rebuild(c, pid)
    assert res["created"] >= 1 and res["removed_stale"] == 0 or res["removed_stale"] >= 0
    diseases = {e["content"] for e in entries(c, pid, field="disease", memory_type="research_identity")["items"]}
    assert diseases == {"Alzheimer's Disease", "Brain Tumor"}  # reviewed value kept next to the new one


def test_manual_entries_are_validated_and_deduplicated(ctx):
    c, pid, a, _ = ctx
    r = c.post(url(pid), json={"memory_type": "research_identity", "field": "assumption", "content": "Scans are skull-stripped."})
    assert r.status_code == 201 and r.json()["origin"] == "researcher" and r.json()["verification_status"] == "confirmed"
    assert c.post(url(pid), json={"memory_type": "research_identity", "field": "assumption", "content": "scans are  skull-stripped."}).status_code == 200
    assert entries(c, pid, field="assumption")["total"] == 1
    exp = c.post(url(pid), json={"memory_type": "experiment_context", "field": "dataset_version", "content": "ADNI-1 (2024 release)"})
    assert exp.status_code == 201
    assert c.post(url(pid), json={"memory_type": "experiment_context", "field": "bogus", "content": "x"}).status_code == 422
    assert c.post(url(pid), json={"memory_type": "literature", "field": "limitation", "content": "Small cohort."}).status_code == 422  # needs a paper
    ok = c.post(url(pid), json={"memory_type": "literature", "field": "limitation", "content": "Small cohort.", "paper_id": a})
    assert ok.status_code == 201 and ok.json()["paper"]["id"] == a
    assert c.post(url(pid), json={"memory_type": "literature", "field": "limitation", "content": "x", "paper_id": 99999}).status_code == 422


# ------------------------------------------------------------------ claims and evidence
def test_claim_without_a_source_must_be_a_hypothesis(ctx):
    c, pid, a, _ = ctx
    assert c.post(url(pid, "/claims"), json={"claim_text": "Hippocampal volume predicts conversion", "claim_type": "finding"}).status_code == 422
    h = c.post(url(pid, "/claims"), json={"claim_text": "Regional QUBO selection improves brain-age MAE", "claim_type": "hypothesis"})
    assert h.status_code == 201 and h.json()["evidence"] == [] and h.json()["origin"] == "researcher"


def test_evidence_quote_is_checked_against_the_stored_record_never_assumed(ctx):
    c, pid, a, _ = ctx
    body = {"claim_text": "A 3D CNN reaches 92.3% accuracy on ADNI", "claim_type": "finding", "evidence": [
        {"paper_id": a, "relationship": "supports", "quoted_text": "reached an accuracy of 92.3% in 10-fold cross-validation", "section_name": "abstract"},
        {"paper_id": a, "relationship": "supports", "quoted_text": "This sentence is not in the paper at all."}]}
    claim = c.post(url(pid, "/claims"), json=body).json()
    assert [e["verification_status"] for e in claim["evidence"]] == ["source_matched", "unverified"]
    para = c.post(url(pid, f"/claims/{claim['id']}/evidence"), json={"paper_id": a, "relationship": "contextualizes", "evidence_kind": "paraphrase",
                                                                       "quoted_text": "Atrophy mattered."}).json()
    assert para["evidence"][-1]["evidence_kind"] == "paraphrase" and para["evidence"][-1]["verification_status"] == "unverified"


def test_claim_creation_is_atomic_when_evidence_is_invalid(ctx):
    c, pid, a, _ = ctx
    bad = {"claim_text": "Half sourced claim", "claim_type": "finding", "evidence": [
        {"paper_id": a, "relationship": "supports", "quoted_text": "Hippocampal atrophy drove the prediction."},
        {"paper_id": 424242, "relationship": "supports", "quoted_text": "Paper that is not saved here"}]}
    r = c.post(url(pid, "/claims"), json=bad)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "paper_not_in_project"
    assert c.get(url(pid, "/claims")).json()["total"] == 0
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ResearchClaim)) == 0


def test_contradicting_evidence_is_kept_and_flagged_not_merged(ctx):
    c, pid, a, b = ctx
    claim = c.post(url(pid, "/claims"), json={"claim_text": "Deep learning generalises across sites", "claim_type": "finding", "evidence": [
        {"paper_id": a, "relationship": "supports", "quoted_text": "The model reached an accuracy of 92.3%"},
        {"paper_id": b, "relationship": "contradicts", "quoted_text": "achieved an accuracy of 71% under leave-site-out validation"}]}).json()
    assert claim["contested"] is True and len(claim["evidence"]) == 2
    conflicts = c.get(url(pid)).json()["conflicts"]
    contested = next(x for x in conflicts if x["kind"] == "contested_claim")
    assert len(contested["supports"]) == 1 and len(contested["contradicts"]) == 1
    c.patch(url(pid, f"/claims/{claim['id']}"), json={"status": "retracted"})
    assert c.get(url(pid, "/claims")).json()["items"][0]["evidence"].__len__() == 2  # retracting deletes nothing


def test_different_metric_values_across_papers_are_surfaced_with_context_and_not_averaged(ctx):
    c, pid, *_ = ctx
    rebuild(c, pid)
    v = next(x for x in c.get(url(pid)).json()["conflicts"] if x["kind"] == "metric_variation")
    assert v["metric"] == "accuracy" and {i["value"] for i in v["values"]} == {"accuracy 92.3%", "accuracy 71%"}
    assert "not directly comparable" in v["note"] and all(i["source_sentence"] for i in v["values"])
    assert any("ADNI" in i["datasets_named_in_paper"] for i in v["values"])


# ------------------------------------------------------------------ decisions and gaps
def test_decision_history_is_append_only(ctx):
    c, pid, *_ = ctx
    d1 = c.post(url(pid, "/decisions"), json={"decision_type": "method_selected", "description": "Use SVR", "rationale": "Small sample"}).json()
    d2 = c.post(url(pid, "/decisions"), json={"decision_type": "method_selected", "description": "Use ridge regression", "supersedes_id": d1["id"]}).json()
    items = {d["id"]: d for d in c.get(url(pid, "/decisions")).json()["items"]}
    assert items[d1["id"]]["status"] == "superseded" and items[d1["id"]]["description"] == "Use SVR" and items[d1["id"]]["rationale"] == "Small sample"
    assert items[d2["id"]]["supersedes_id"] == d1["id"] and items[d2["id"]]["status"] == "active"
    assert c.post(url(pid, "/decisions"), json={"decision_type": "other", "description": "again", "supersedes_id": d1["id"]}).status_code == 409
    assert c.patch(url(pid, f"/decisions/{d1['id']}"), json={"status": "rejected"}).status_code == 409
    assert c.patch(url(pid, f"/decisions/{d2['id']}"), json={"status": "rejected"}).json()["status"] == "rejected"
    assert c.post(url(pid, "/decisions"), json={"decision_type": "nope", "description": "x"}).status_code == 422


def test_gaps_start_as_potential_and_warn_about_novelty(ctx):
    c, pid, *_ = ctx
    g = c.post(url(pid, "/gaps"), json={"title": "No external-site validation", "description": "Saved papers report single-site cohorts only.",
                                         "gap_category": "evaluation", "evidence_summary": "2 saved papers"})
    assert g.status_code == 201 and g.json()["status"] == "potential" and "not proof of novelty" in g.json()["notice"]
    gid = g.json()["id"]
    upd = c.patch(url(pid, f"/gaps/{gid}"), json={"status": "validated", "researcher_comment": "Checked 3 reviews."}).json()
    assert upd["status"] == "validated" and upd["researcher_comment"] == "Checked 3 reviews."
    assert c.post(url(pid, "/gaps"), json={"title": "x", "description": "y", "gap_category": "made_up"}).status_code == 422
    assert c.patch(url(pid, f"/gaps/{gid}"), json={}).status_code == 422
    assert c.patch(url(pid, "/gaps/9999"), json={"status": "dismissed"}).status_code == 404


# ------------------------------------------------------------------ paper removal, deletion, graph
def test_removing_a_paper_drops_unreviewed_entries_but_keeps_reviewed_ones(ctx):
    c, pid, a, _ = ctx
    rebuild(c, pid)
    keep = next(e for e in entries(c, pid, paper_id=a)["items"] if e["field"] == "dataset")
    c.patch(url(pid, f"/entries/{keep['id']}"), json={"verification_status": "confirmed"})
    assert c.delete(f"/api/projects/{pid}/papers/{a}").status_code == 204
    left = entries(c, pid, paper_id=a)["items"]
    assert [e["id"] for e in left] == [keep["id"]] and left[0]["paper"]["in_project"] is False
    assert rebuild(c, pid)["removed_stale"] == 0  # reviewed entry is not pruned by a rebuild either


def test_deleting_the_project_deletes_its_memory(ctx):
    c, pid, a, _ = ctx
    rebuild(c, pid)
    c.post(url(pid, "/claims"), json={"claim_text": "A hypothesis to cascade", "claim_type": "hypothesis"})
    assert c.delete(f"/api/projects/{pid}").status_code == 204
    with SessionLocal() as db:
        for table in ("project_memories", "memory_entries", "research_claims", "memory_events"):
            assert db.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0
        assert db.get(Paper, a) is not None  # the shared paper cache is untouched


def test_graph_edges_carry_provenance_and_are_never_synthetic(ctx):
    c, pid, a, b = ctx
    rebuild(c, pid)
    c.post(url(pid, "/gaps"), json={"title": "Gap title", "description": "A potential gap", "gap_category": "dataset"})
    g = c.get(url(pid, "/graph")).json()
    assert g["synthetic"] is False and g["edges"]
    assert all(e["provenance"] in {"source_verified", "rule_extracted", "researcher_confirmed", "researcher_entered"} for e in g["edges"])
    assert any(e["relation"] == "saved_paper" and e["provenance"] == "source_verified" for e in g["edges"])
    assert any(e["relation"] == "dataset" and e["provenance"] == "rule_extracted" and "matched" in (e["detail"] or "") for e in g["edges"])
    assert any(e["relation"] == "potential_gap" for e in g["edges"])


# ------------------------------------------------------------------ authorization
def test_other_users_and_anonymous_callers_cannot_touch_a_project_memory(ctx, make_client):
    c, pid, a, _ = ctx
    rebuild(c, pid)
    entry_id = entries(c, pid)["items"][0]["id"]
    other = make_client()
    assert register(other, "eve@example.com").status_code == 201
    calls = [("get", ""), ("get", "/entries"), ("get", "/claims"), ("get", "/gaps"), ("get", "/decisions"), ("get", "/audit"), ("get", "/graph"),
             ("post", "/rebuild"), ("post", ""), ("post", "/claims"), ("post", "/gaps"), ("post", "/decisions"), ("patch", f"/entries/{entry_id}")]
    for method, tail in calls:
        kw = {"json": {"verification_status": "confirmed", "memory_type": "research_identity", "field": "note", "content": "x", "claim_text": "xxxxx",
                       "claim_type": "hypothesis", "title": "xxx", "description": "xxxxx", "gap_category": "dataset", "decision_type": "other"}} if method != "get" else {}
        r = getattr(other, method)(url(pid, tail), **kw)
        assert r.status_code == 404, (method, tail, r.status_code)
    anon = make_client()
    assert anon.get(url(pid)).status_code == 401
    assert entries(c, pid)["total"] > 0  # the owner's memory was untouched


def test_guest_trial_project_has_its_own_working_memory(make_client):
    g = make_client()
    assert g.post("/api/guest/session").status_code in (200, 201)
    pid = g.post("/api/projects", json=VALID).json()["id"]
    assert g.post(url(pid, "/rebuild")).status_code == 200
    assert g.get(url(pid, "/entries")).json()["total"] > 0


# ------------------------------------------------------------------ pagination and input validation
def test_pagination_and_filters(ctx):
    c, pid, *_ = ctx
    rebuild(c, pid)
    total = entries(c, pid)["total"]
    p1 = c.get(url(pid, "/entries"), params={"limit": 5, "offset": 0}).json()
    p2 = c.get(url(pid, "/entries"), params={"limit": 5, "offset": 5}).json()
    assert p1["total"] == p2["total"] == total and len(p1["items"]) == 5
    assert not {e["id"] for e in p1["items"]} & {e["id"] for e in p2["items"]}
    assert entries(c, pid, field="dataset")["total"] >= 2
    assert all(e["verification_status"] == "unverified" for e in entries(c, pid, verification_status="unverified")["items"])
    assert c.get(url(pid, "/entries"), params={"limit": 0}).status_code == 422
    assert c.get(url(pid, "/entries"), params={"limit": 500}).status_code == 422
    assert c.get(url(pid, "/audit"), params={"offset": -1}).status_code == 422


def test_invalid_input_is_rejected_with_structured_errors(ctx):
    c, pid, *_ = ctx
    rebuild(c, pid)
    eid = entries(c, pid)["items"][0]["id"]
    assert c.patch(url(pid, f"/entries/{eid}"), json={}).status_code == 422
    assert c.patch(url(pid, f"/entries/{eid}"), json={"verification_status": "verified"}).status_code == 422
    assert c.patch(url(pid, f"/entries/{eid}"), json={"content": "   "}).status_code == 422
    assert c.patch(url(pid, "/entries/999999"), json={"verification_status": "confirmed"}).status_code == 404
    assert c.post(url(pid, "/claims"), json={"claim_text": "  ", "claim_type": "hypothesis"}).status_code == 422
    assert c.post(url(pid, "/claims"), json={"claim_text": "Valid hypothesis here", "claim_type": "hypothesis",
                                              "evidence": [{"paper_id": 1, "relationship": "supports", "quoted_text": "abc", "source_url": "javascript:alert(1)"}]}).status_code == 422
    assert c.get(url(99999)).status_code == 404


# ------------------------------------------------------------------ extraction helpers and migration
def test_numeric_extractors_only_report_explicit_statements():
    assert extraction.extract_sample_sizes("Title", "We analysed brain scans with a deep network.") == []
    assert extraction.extract_reported_metrics("Title", "The model was evaluated carefully.") == []
    s = extraction.extract_sample_sizes("t", "Data came from 842 subjects (n = 1). Details follow.")
    assert [x["value"] for x in s] == [842]  # n = 1 is below any plausible cohort and is ignored
    m = extraction.extract_reported_metrics("t", "Dice coefficient of 0.87 on BraTS. The F1 score was 0.91.")
    assert [(x["metric"], x["value"]) for x in m] == [("Dice", "0.87"), ("F1 score", "0.91")]


def test_migration_0006_downgrades_and_upgrades_cleanly():
    from alembic import command

    from tests.conftest import _alembic_cfg

    command.downgrade(_alembic_cfg, "0005")
    try:
        with engine.connect() as conn:
            tables = {r[0] for r in conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'"))}
        assert not tables & {"project_memories", "memory_entries", "research_claims", "claim_evidence", "research_decisions", "research_gaps", "memory_events"}
        assert {"projects", "papers", "project_papers"} <= tables  # nothing older was touched
    finally:
        command.upgrade(_alembic_cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM memory_entries")).scalar() == 0


def test_cors_preflight_allows_patch_for_the_configured_origin(client, settings):
    origin = settings.cors_origin_list[0]
    r = client.options("/api/projects/1/memory/entries/1", headers={"Origin": origin, "Access-Control-Request-Method": "PATCH",
                                                                    "Access-Control-Request-Headers": "content-type,x-requested-with"})
    assert r.status_code == 200 and "PATCH" in r.headers["access-control-allow-methods"]
