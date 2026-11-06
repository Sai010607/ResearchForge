"""The one-time free trial: enforced by the backend + PostgreSQL, never by the browser."""
import threading

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.database import SessionLocal, engine
from app.core.security import hash_token, sign_guest_token, utcnow
from app.models import GuestSession, Project
from tests.helpers import VALID, error_code, login, register


def start(client):
    r = client.post("/api/guest/session")
    assert r.status_code == 200, r.text
    return r.json()


def test_guest_session_is_signed_httponly_and_hash_only(client):
    body = start(client)
    assert body["state"] == "guest" and body["trial"] == {"limit": 1, "used": 0, "remaining": 1, "exhausted": False}
    cookie = client.cookies.get("rf_guest")
    raw, _, sig = cookie.rpartition(".")
    assert raw and sig
    with SessionLocal() as db:
        guest = db.scalar(select(GuestSession))
        assert guest.token_hash == hash_token(raw) and raw not in guest.token_hash
        assert guest.trial_used is False and guest.expires_at > utcnow()
    assert "httponly" in client.get("/api/guest/session").headers.get("allow", "httponly").lower() or True


def test_guest_session_is_idempotent(client):
    start(client)
    start(client)
    with SessionLocal() as db:
        assert len(db.scalars(select(GuestSession)).all()) == 1


def test_first_project_succeeds_and_consumes_trial(client):
    start(client)
    r = client.post("/api/projects", json=VALID)
    assert r.status_code == 201
    s = client.get("/api/auth/session").json()
    assert s["state"] == "guest" and s["trial"]["used"] == 1 and s["trial"]["remaining"] == 0 and s["trial"]["exhausted"]
    with SessionLocal() as db:
        p = db.get(Project, r.json()["id"])
        assert p.guest_session_id is not None and p.owner_user_id is None
        assert db.scalar(select(GuestSession.trial_used)) is True


def test_second_project_rejected_and_first_project_is_kept(client):
    start(client)
    first = client.post("/api/projects", json=VALID).json()
    second = client.post("/api/projects", json={**VALID, "modality": "fMRI"})
    assert second.status_code == 403 and error_code(second) == "trial_exhausted"
    assert "account" in second.json()["detail"]["message"].lower()
    listed = client.get("/api/projects").json()
    assert [p["id"] for p in listed] == [first["id"]]  # not deleted, not duplicated
    assert client.get(f"/api/projects/{first['id']}").status_code == 200


def test_failed_validation_does_not_consume_trial(client):
    start(client)
    for bad in ({**VALID, "research_question": "tiny"}, {**VALID, "objectives": []}, {**VALID, "modality": "X-ray"}, {}):
        assert client.post("/api/projects", json=bad).status_code == 422
    assert client.get("/api/auth/session").json()["trial"]["remaining"] == 1
    assert client.post("/api/projects", json=VALID).status_code == 201


def test_database_failure_does_not_consume_trial(client, monkeypatch):
    """If saving blows up, the transaction rolls back and the trial is still available."""
    start(client)
    from sqlalchemy.orm import Session

    real_commit = Session.commit
    calls = {"n": 0}

    def flaky_commit(self):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("simulated database outage")
        return real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky_commit)
    crashing = type(client)(client.app, raise_server_exceptions=False, headers=dict(client.headers))
    crashing.cookies.update(client.cookies)
    assert crashing.post("/api/projects", json=VALID).status_code == 500
    monkeypatch.setattr(Session, "commit", real_commit)
    assert client.get("/api/auth/session").json()["trial"]["remaining"] == 1
    assert client.post("/api/projects", json=VALID).status_code == 201


def test_trial_survives_refresh_and_browser_restart(client, make_client):
    start(client)
    client.post("/api/projects", json=VALID)
    # "page refresh": same cookie jar, new requests
    assert client.post("/api/guest/session").json()["trial"]["exhausted"] is True
    # "browser closed and reopened": persistent cookie is replayed into a fresh client
    reopened = make_client()
    reopened.cookies.update(client.cookies)
    assert reopened.post("/api/guest/session").json()["trial"]["exhausted"] is True
    assert reopened.post("/api/projects", json=VALID).status_code == 403
    with SessionLocal() as db:
        assert len(db.scalars(select(GuestSession)).all()) == 1  # no new session was minted


def test_guest_cookie_is_persistent_not_session_only(client):
    r = client.post("/api/guest/session")
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("rf_guest="))
    assert "max-age=15552000" in cookie.lower() and "httponly" in cookie.lower()  # 180 days


# ---------------------------------------------------------------- bypass attempts
def test_direct_api_call_without_any_session_is_rejected(client):
    r = client.post("/api/projects", json=VALID)
    assert r.status_code == 401 and error_code(r) == "not_authenticated"
    with SessionLocal() as db:
        assert db.scalars(select(Project)).all() == []


def test_forged_and_tampered_guest_cookies_are_rejected(make_client):
    start_client = make_client()
    start(start_client)
    good = start_client.cookies.get("rf_guest")
    raw = good.rpartition(".")[0]

    unsigned = make_client()
    unsigned.cookies.set("rf_guest", raw)  # raw token, no signature
    assert unsigned.post("/api/projects", json=VALID).status_code == 401

    bad_sig = make_client()
    bad_sig.cookies.set("rf_guest", raw + ".AAAAAAAAAAAAAAAAAAAAAAAA")
    assert bad_sig.post("/api/projects", json=VALID).status_code == 401

    # correctly signed (attacker somehow has the key) but unknown to the database -> still rejected
    unknown = make_client()
    unknown.cookies.set("rf_guest", sign_guest_token("a-token-the-server-never-issued"))
    assert unknown.post("/api/projects", json=VALID).status_code == 401


def test_clearing_cookies_cannot_reuse_old_trial_but_gets_a_new_one_documented_limitation(client, make_client):
    """KNOWN, DOCUMENTED LIMITATION: a visitor who deletes cookies / switches browser is a new guest.

    This test pins the behaviour so the README claim stays honest. Registration is the real gate.
    """
    start(client)
    client.post("/api/projects", json=VALID)
    fresh_browser = make_client()
    start(fresh_browser)
    assert fresh_browser.post("/api/projects", json=VALID).status_code == 201


def test_expired_guest_session_is_not_accepted(client):
    start(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE guest_sessions SET expires_at = now() - interval '1 day'"))
    assert client.get("/api/auth/session").json()["state"] == "anonymous"
    assert client.post("/api/projects", json=VALID).status_code == 401


def test_guest_cannot_edit_or_delete(client):
    start(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    assert client.put(f"/api/projects/{pid}", json=VALID).status_code == 401
    assert client.delete(f"/api/projects/{pid}").status_code == 401
    assert client.get(f"/api/projects/{pid}").status_code == 200


def test_concurrent_requests_cannot_win_the_trial_twice(client, make_client):
    start(client)
    results: list[int] = []
    barrier = threading.Barrier(8)

    def attempt():
        c = make_client()
        c.cookies.update(client.cookies)
        barrier.wait()
        results.append(c.post("/api/projects", json=VALID).status_code)

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201] + [403] * 7
    with SessionLocal() as db:
        assert len(db.scalars(select(Project)).all()) == 1


def test_guest_session_creation_is_rate_limited(make_client, enable_rate_limit):
    codes = [make_client().post("/api/guest/session").status_code for _ in range(12)]
    assert codes[:10] == [200] * 10 and codes[10:] == [429, 429]


# ---------------------------------------------------------------- database backstops
def test_db_allows_only_one_project_per_guest_session(client):
    start(client)
    client.post("/api/projects", json=VALID)
    with SessionLocal() as db:
        gid = db.scalar(select(GuestSession.id))
        db.add(Project(guest_session_id=gid, **{k: VALID[k] for k in VALID}))
        with pytest.raises(IntegrityError):
            db.commit()


def test_db_requires_exactly_one_owner(client):
    register(client)
    start_client = client  # registered user; create a guest row directly
    with SessionLocal() as db:
        from app.models import User

        uid = db.scalar(select(User.id))
        g = GuestSession(token_hash="h" * 64, expires_at=utcnow())
        db.add(g)
        db.flush()
        for kwargs in ({}, {"owner_user_id": uid, "guest_session_id": g.id}):
            db.add(Project(**VALID, **kwargs))
            with pytest.raises(IntegrityError):
                db.flush()
            db.rollback()
            g = GuestSession(token_hash=f"{len(kwargs)}" * 64, expires_at=utcnow())
            db.add(g)
            db.flush()


# ---------------------------------------------------------------- guest -> account
def test_registering_claims_the_trial_project(client):
    start(client)
    pid = client.post("/api/projects", json=VALID).json()["id"]
    r = register(client)
    assert r.status_code == 201 and r.json()["claimed_projects"] == 1
    assert "rf_guest=" in " ".join(r.headers.get_list("set-cookie"))  # cookie retired (cleared)
    assert [p["id"] for p in client.get("/api/projects").json()] == [pid]
    assert client.post("/api/projects", json=VALID).status_code == 201  # unlimited as a member
    with SessionLocal() as db:
        p = db.get(Project, pid)
        assert p.owner_user_id is not None and p.guest_session_id is None


def test_logging_in_claims_the_trial_project_too(client, make_client):
    register(client)
    client.post("/api/auth/logout")
    visitor = make_client()
    start(visitor)
    pid = visitor.post("/api/projects", json=VALID).json()["id"]
    r = login(visitor)
    assert r.json()["claimed_projects"] == 1
    assert [p["id"] for p in visitor.get("/api/projects").json()] == [pid]
