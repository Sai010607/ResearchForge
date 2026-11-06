"""Users must never see or touch each other's data (or the pre-auth 'legacy' projects)."""
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models import Project, User
from tests.helpers import VALID, error_code, register


def test_user_cannot_list_read_edit_or_delete_another_users_project(client, make_client):
    register(client, email="alice@example.com", full_name="Alice A")
    pid = client.post("/api/projects", json=VALID).json()["id"]

    bob = make_client()
    register(bob, email="bob@example.com", full_name="Bob B")
    assert bob.get("/api/projects").json() == []
    r = bob.get(f"/api/projects/{pid}")
    assert r.status_code == 404 and error_code(r) == "not_found"  # 404, not 403: ids can't be probed
    assert bob.put(f"/api/projects/{pid}", json={**VALID, "disease": "Brain Tumor"}).status_code == 404
    assert bob.delete(f"/api/projects/{pid}").status_code == 404

    mine = client.get(f"/api/projects/{pid}").json()
    assert mine["disease"] == "Alzheimer's Disease"  # untouched
    assert len(client.get("/api/projects").json()) == 1


def test_each_user_sees_only_their_own_history(client, make_client):
    register(client, email="alice@example.com")
    bob = make_client()
    register(bob, email="bob@example.com")
    for _ in range(3):
        client.post("/api/projects", json=VALID)
    bob.post("/api/projects", json={**VALID, "modality": "fMRI"})
    assert len(client.get("/api/projects").json()) == 3
    assert [p["modality"] for p in bob.get("/api/projects").json()] == ["fMRI"]


def test_guest_cannot_see_a_users_project(client, make_client):
    register(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    guest = make_client()
    guest.post("/api/guest/session")
    assert guest.get("/api/projects").json() == []
    assert guest.get(f"/api/projects/{pid}").status_code == 404


def test_guests_cannot_see_each_others_trial_projects(make_client):
    a, b = make_client(), make_client()
    a.post("/api/guest/session")
    b.post("/api/guest/session")
    pid = a.post("/api/projects", json=VALID).json()["id"]
    assert b.get(f"/api/projects/{pid}").status_code == 404
    assert b.get("/api/projects").json() == []


def test_legacy_projects_are_not_visible_to_new_users(client):
    with SessionLocal() as db:
        legacy = User(full_name="Legacy", email="legacy@researchforge.invalid", password_hash="!disabled", is_active=False)
        db.add(legacy)
        db.flush()
        db.add(Project(owner_user_id=legacy.id, **VALID))
        db.commit()
    register(client)
    assert client.get("/api/projects").json() == []


def test_claim_legacy_script_moves_projects_to_a_real_account(client, monkeypatch):
    import sys

    from app.scripts import claim_legacy

    with SessionLocal() as db:
        legacy = User(full_name="Legacy", email="legacy@researchforge.invalid", password_hash="!disabled", is_active=False)
        db.add(legacy)
        db.flush()
        db.add_all([Project(owner_user_id=legacy.id, **VALID) for _ in range(2)])
        db.commit()
    register(client, email="me@example.com")
    monkeypatch.setattr(sys, "argv", ["claim_legacy", "--email", "me@example.com"])
    assert claim_legacy.main() == 0
    assert len(client.get("/api/projects").json()) == 2
    with SessionLocal() as db:
        assert db.scalars(select(Project).where(Project.owner_user_id == db.scalar(select(User.id).where(User.email == "legacy@researchforge.invalid")))).all() == []
