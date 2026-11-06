"""Project CRUD for a registered user (Phase 1 behaviour, now owner-scoped)."""
import pytest

from app.core.database import SessionLocal
from app.models import Project
from tests.helpers import VALID, register


@pytest.fixture()
def authed(client):
    assert register(client).status_code == 201
    return client


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] == "connected"


def test_create_and_persist(authed):
    r = authed.post("/api/projects", json=VALID)
    assert r.status_code == 201
    body = r.json()
    assert body["objectives"] == VALID["objectives"]
    with SessionLocal() as db:  # brand-new session -> proves it is in PostgreSQL
        p = db.get(Project, body["id"])
        assert p.research_question == VALID["research_question"]
        assert p.owner_user_id is not None and p.guest_session_id is None
    assert [p["id"] for p in authed.get("/api/projects").json()] == [body["id"]]


def test_list_newest_first(authed):
    authed.post("/api/projects", json=VALID)
    authed.post("/api/projects", json={**VALID, "modality": "fMRI"})
    assert [p["modality"] for p in authed.get("/api/projects").json()] == ["fMRI", "T1-weighted MRI"]


def test_validation_errors(authed):
    assert authed.post("/api/projects", json={**VALID, "research_question": "short"}).status_code == 422
    assert authed.post("/api/projects", json={**VALID, "modality": "X-ray"}).status_code == 422
    assert authed.post("/api/projects", json={**VALID, "objectives": []}).status_code == 422
    assert authed.post("/api/projects", json={**VALID, "objectives": ["Nonsense"]}).status_code == 422


def test_update_and_delete(authed):
    pid = authed.post("/api/projects", json=VALID).json()["id"]
    r = authed.put(f"/api/projects/{pid}", json={**VALID, "disease": "Brain Tumor"})
    assert r.status_code == 200 and r.json()["disease"] == "Brain Tumor"
    assert authed.put(f"/api/projects/{pid}", json={**VALID, "research_question": "no"}).status_code == 422
    assert authed.delete(f"/api/projects/{pid}").status_code == 204
    assert authed.get(f"/api/projects/{pid}").status_code == 404
    assert authed.delete(f"/api/projects/{pid}").status_code == 404


def test_registered_user_can_create_many(authed):
    for _ in range(5):
        assert authed.post("/api/projects", json=VALID).status_code == 201
    assert len(authed.get("/api/projects").json()) == 5


def test_per_user_project_limit(authed, settings, monkeypatch):
    monkeypatch.setattr(settings, "max_projects_per_user", 2)
    assert authed.post("/api/projects", json=VALID).status_code == 201
    assert authed.post("/api/projects", json=VALID).status_code == 201
    r = authed.post("/api/projects", json=VALID)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "project_limit_reached"


def test_per_user_creation_rate_limit(authed, settings, monkeypatch, enable_rate_limit):
    monkeypatch.setattr(settings, "project_creates_per_hour", 2)
    assert authed.post("/api/projects", json=VALID).status_code == 201
    assert authed.post("/api/projects", json=VALID).status_code == 201
    r = authed.post("/api/projects", json=VALID)
    assert r.status_code == 429 and "retry-after" in r.headers
