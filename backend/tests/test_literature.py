"""Literature: parsing, extraction, search, save/list/remove, isolation, error mapping.

Upstream HTTP is replaced by fixtures shaped like the documented OpenAlex / Europe PMC responses
(the sandbox has no internet). `python -m app.scripts.check_literature` runs the same code against
the LIVE services.
"""
import pytest

from app.services import extraction, literature
from tests.helpers import VALID, error_code, register

OA_W1 = {
    "id": "https://openalex.org/W1001",
    "doi": "https://doi.org/10.1000/ABC.1",
    "title": "Interpretable T1-weighted MRI biomarkers for Alzheimer's disease using a 3D CNN on ADNI",
    "publication_year": 2023,
    "cited_by_count": 41,
    "abstract_inverted_index": {"We": [0], "train": [1], "a": [2], "3D": [3], "CNN": [4], "on": [5], "ADNI": [6], "data.": [7]},
    "authorships": [{"author": {"display_name": "Ada Lovelace"}}, {"author": {"display_name": "Alan Turing"}}],
    "primary_location": {"landing_page_url": "https://example.org/w1001", "source": {"display_name": "NeuroImage"}},
    "keywords": [{"display_name": "Alzheimer's disease"}, {"display_name": "Biomarkers"}],
    "ids": {"pmid": "https://pubmed.ncbi.nlm.nih.gov/111"},
    "referenced_works": ["https://openalex.org/W1002"],
}
OA_W2 = {
    "id": "https://openalex.org/W1002",
    "doi": None,
    "title": "Hippocampal atrophy in mild cognitive impairment",
    "publication_year": 2019,
    "cited_by_count": 300,
    "abstract_inverted_index": None,
    "authorships": [{"author": {"display_name": "Grace Hopper"}}],
    "primary_location": None,
    "keywords": [],
    "topics": [{"display_name": "Neuroimaging"}],
    "referenced_works": [],
}
EPMC_REC = {
    "id": "111", "source": "MED", "pmid": "111", "doi": "10.1000/abc.1",
    "title": "Interpretable T1-weighted MRI biomarkers for Alzheimer's disease using a 3D CNN on ADNI",
    "authorString": "Lovelace A, Turing A.", "journalTitle": "NeuroImage", "pubYear": "2023",
    "abstractText": "<h4>Background</h4> We train a 3D CNN on ADNI data.", "citedByCount": 40,
    "keywordList": {"keyword": ["Alzheimer Disease"]},
}
EPMC_ONLY = {
    "id": "333", "source": "MED", "pmid": "333", "title": "Resting-state fMRI connectivity in autism using ABIDE",
    "authorString": "Hopper G.", "journalTitle": "Brain", "pubYear": "2021", "abstractText": "Graph neural network on ABIDE.",
}


@pytest.fixture()
def upstream(monkeypatch):
    calls = []
    state = {"fail": set()}

    def fake(url, params):
        calls.append((url, dict(params)))
        if "openalex" in url and "openalex" in state["fail"]:
            raise literature.LiteratureError("OpenAlex is down")
        if "ebi.ac.uk" in url and "europepmc" in state["fail"]:
            raise literature.LiteratureError("Europe PMC is down")
        if url.endswith("/works"):
            return {"results": [OA_W1, OA_W2]}
        if "/works/W1001" in url:
            return OA_W1
        if "/works/W1002" in url:
            return OA_W2
        if "/works/W9999" in url:
            raise literature.PaperNotFound("Paper not found at the source.")
        if "ebi.ac.uk" in url:
            q = params["query"]
            if q.startswith("EXT_ID:"):
                return {"resultList": {"result": [EPMC_REC] if "111" in q else ([EPMC_ONLY] if "333" in q else [])}}
            return {"resultList": {"result": [EPMC_REC, EPMC_ONLY]}}
        raise AssertionError(url)

    monkeypatch.setattr(literature, "http_get_json", fake)
    fake.calls, fake.state = calls, state
    return fake


def project(client):
    return client.post("/api/projects", json=VALID).json()["id"]


# ------------------------------------------------------------------ parsing + extraction
def test_openalex_abstract_is_rebuilt_in_order_and_doi_normalised():
    p = literature.parse_openalex_work(OA_W1)
    assert p["abstract"] == "We train a 3D CNN on ADNI data."
    assert p["doi"] == "10.1000/abc.1" and p["pmid"] == "111" and p["external_id"] == "W1001"
    assert p["authors"] == ["Ada Lovelace", "Alan Turing"] and p["reference_ids"] == ["W1002"]


def test_missing_fields_stay_missing_nothing_is_invented():
    p = literature.parse_openalex_work(OA_W2)
    assert p["abstract"] is None and p["doi"] is None and p["venue"] is None
    assert p["keywords"] == ["Neuroimaging"]  # falls back to topics, which the source supplied


def test_europepmc_html_is_stripped():
    p = literature.parse_europepmc_record(EPMC_REC)
    assert p["abstract"] == "Background We train a 3D CNN on ADNI data."
    assert p["external_id"] == "MED:111" and p["year"] == 2023 and p["authors"] == ["Lovelace A", "Turing A"]


def test_extraction_records_the_matched_evidence():
    x = extraction.extract_metadata(OA_W1["title"], "We train a 3D CNN on ADNI data.", [])
    assert [m["value"] for m in x["modalities"]] == ["T1-weighted MRI"]
    assert x["datasets"][0] == {"value": "ADNI", "matched": "ADNI", "field": "title"}
    assert {m["value"] for m in x["methods"]} >= {"Convolutional neural network", "Explainable AI"}
    assert x["diseases"][0]["value"] == "Alzheimer's Disease"
    assert "rule-based" in x["method"]


def test_extraction_finds_nothing_when_nothing_matches():
    x = extraction.extract_metadata("A study of cats", None, [])
    assert x["modalities"] == x["datasets"] == x["methods"] == x["diseases"] == [] and x["abstract_available"] is False


# ------------------------------------------------------------------ search
def test_search_requires_identity(make_client):
    r = make_client().get("/api/literature/search?q=alzheimer mri")
    assert r.status_code == 401 and error_code(r) == "not_authenticated"


def test_search_merges_sources_and_dedupes_by_doi(client, upstream):
    register(client)
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,europepmc"})
    assert r.status_code == 200
    body = r.json()
    titles = [p["title"] for p in body["results"]]
    assert len(titles) == 3  # W1001 + W1002 + EPMC-only; EPMC duplicate of W1001 merged by DOI
    assert body["results"][0]["source"] == "openalex" and body["warnings"] == [] and body["total_unique"] == 3 and [p["count"] for p in body["providers"]] == [2, 2]
    assert body["results"][0]["extracted"]["datasets"][0]["value"] == "ADNI"


def test_one_failing_source_becomes_a_warning(client, upstream):
    register(client)
    upstream.state["fail"].add("openalex")
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,europepmc"})
    assert r.status_code == 200 and len(r.json()["results"]) == 2
    assert "OpenAlex" in r.json()["warnings"][0]


def test_all_sources_failing_is_a_clear_502(client, upstream):
    register(client)
    upstream.state["fail"].update({"openalex", "europepmc"})
    r = client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,europepmc"})
    assert r.status_code == 502 and error_code(r) == "literature_unavailable"


def test_search_validates_query(client, upstream):
    register(client)
    assert client.get("/api/literature/search", params={"q": "ab"}).status_code == 422
    assert client.get("/api/literature/search", params={"q": "x" * 201}).status_code == 422
    assert upstream.calls == []


# ------------------------------------------------------------------ save / list / remove
def test_save_fetches_from_source_and_is_idempotent(client, upstream):
    register(client)
    pid = project(client)
    r = client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"})
    assert r.status_code == 201 and r.json()["title"].startswith("Interpretable")
    again = client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"})
    assert again.status_code == 200
    assert len(client.get(f"/api/projects/{pid}/papers").json()) == 1


def test_client_cannot_inject_paper_content(client, upstream):
    register(client)
    pid = project(client)
    r = client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001", "title": "FAKE"})
    assert r.json()["title"] != "FAKE"


def test_unknown_paper_is_404_and_source_outage_is_502(client, upstream):
    register(client)
    pid = project(client)
    assert client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W9999"}).status_code == 404
    assert client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "not-an-id"}).status_code == 404
    upstream.state["fail"].add("openalex")
    r = client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1002"})
    assert r.status_code == 502 and error_code(r) == "literature_unavailable"


def test_same_paper_from_two_sources_is_stored_once(client, upstream):
    register(client)
    pid = project(client)
    client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"})
    client.post(f"/api/projects/{pid}/papers", json={"source": "europepmc", "external_id": "MED:111"})
    assert len(client.get(f"/api/projects/{pid}/papers").json()) == 1  # same DOI


def test_citation_links_between_saved_papers(client, upstream):
    register(client)
    pid = project(client)
    for w in ("W1001", "W1002"):
        client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": w})
    papers = {p["external_id"]: p for p in client.get(f"/api/projects/{pid}/papers").json()}
    assert papers["W1001"]["cites"] == [papers["W1002"]["id"]] and papers["W1002"]["cites"] == []


def test_remove_paper(client, upstream):
    register(client)
    pid = project(client)
    paper = client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"}).json()
    assert client.delete(f"/api/projects/{pid}/papers/{paper['id']}").status_code == 204
    assert client.get(f"/api/projects/{pid}/papers").json() == []
    assert client.delete(f"/api/projects/{pid}/papers/{paper['id']}").status_code == 404


def test_paper_limit_per_project(client, upstream, settings, monkeypatch):
    register(client)
    pid = project(client)
    monkeypatch.setattr(settings, "max_papers_per_project", 1)
    client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"})
    r = client.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1002"})
    assert r.status_code == 403 and error_code(r) == "paper_limit_reached"


# ------------------------------------------------------------------ isolation
def test_other_users_cannot_see_or_touch_my_papers(make_client, upstream):
    ada, bob = make_client(), make_client()
    register(ada, "ada@example.com")
    register(bob, "bob@example.com")
    pid = project(ada)
    paper = ada.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"}).json()
    assert bob.get(f"/api/projects/{pid}/papers").status_code == 404
    assert bob.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1002"}).status_code == 404
    assert bob.delete(f"/api/projects/{pid}/papers/{paper['id']}").status_code == 404
    assert bob.get("/api/papers/mine").json() == []  # shared cache row is invisible to Bob
    assert len(ada.get("/api/papers/mine").json()) == 1


def test_mine_lists_papers_across_projects_with_project_ids(client, upstream):
    register(client)
    a, b = project(client), project(client)
    client.post(f"/api/projects/{a}/papers", json={"source": "openalex", "external_id": "W1001"})
    client.post(f"/api/projects/{b}/papers", json={"source": "openalex", "external_id": "W1001"})
    mine = client.get("/api/papers/mine").json()
    assert len(mine) == 1 and mine[0]["project_ids"] == [a, b]


def test_guest_can_save_to_their_trial_project_only(make_client, upstream):
    guest = make_client()
    assert guest.post("/api/guest/session").status_code == 200
    pid = project(guest)
    assert guest.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"}).status_code == 201
    other = make_client()
    other.post("/api/guest/session")
    assert other.post(f"/api/projects/{pid}/papers", json={"source": "openalex", "external_id": "W1001"}).status_code == 404


def test_deleting_a_project_removes_its_links_but_keeps_other_users_data(make_client, upstream):
    ada, bob = make_client(), make_client()
    register(ada, "ada@example.com")
    register(bob, "bob@example.com")
    pa, pb = project(ada), project(bob)
    for c, p in ((ada, pa), (bob, pb)):
        c.post(f"/api/projects/{p}/papers", json={"source": "openalex", "external_id": "W1001"})
    assert ada.delete(f"/api/projects/{pa}").status_code == 204
    assert ada.get("/api/papers/mine").json() == []
    assert len(bob.get("/api/papers/mine").json()) == 1


def test_search_is_rate_limited(client, upstream, enable_rate_limit, settings, monkeypatch):
    register(client)
    monkeypatch.setattr(settings, "literature_searches_per_hour", 2)
    codes = [client.get("/api/literature/search", params={"q": "alzheimer mri", "providers": "openalex,europepmc"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
