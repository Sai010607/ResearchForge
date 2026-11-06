import pytest
from sqlalchemy import select, update

from app.core import mailer
from app.core.database import SessionLocal
from app.core.security import utcnow
from app.models import RefreshSession, User
from tests.helpers import PASSWORD, error_code, last_token, login, register, register_payload


# ------------------------------------------------------------------ registration
def test_register_success_logs_in_and_stores_argon2id(client):
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["state"] == "user" and body["user"]["email"] == "ada@example.com"
    assert "password" not in body["user"]  # no hash/password field is ever returned
    set_cookie = " ".join(r.headers.get_list("set-cookie")).lower()
    assert "rf_access=" in set_cookie and "rf_refresh=" in set_cookie
    assert set_cookie.count("httponly") >= 2 and "samesite=lax" in set_cookie
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "ada@example.com"))
        assert user.password_hash.startswith("$argon2id$")
        assert PASSWORD not in user.password_hash
        assert user.is_verified is False and user.terms_accepted_at is not None
        # only hashes of refresh tokens are stored
        raw_refresh = client.cookies.get("rf_refresh")
        stored = db.scalars(select(RefreshSession.token_hash)).all()
        assert raw_refresh and raw_refresh not in stored and len(stored[0]) == 64
    assert client.get("/api/auth/session").json()["user"]["full_name"] == "Ada Lovelace"


def test_register_duplicate_email_rejected_case_insensitively(client, make_client):
    assert register(client).status_code == 201
    r = register(make_client(), email="ADA@Example.com")
    assert r.status_code == 409 and error_code(r) == "email_taken"
    with SessionLocal() as db:
        assert len(db.scalars(select(User)).all()) == 1


@pytest.mark.parametrize(
    "over",
    [
        {"password": "short1", "confirm_password": "short1"},
        {"password": "onlyletterspassword", "confirm_password": "onlyletterspassword"},
        {"password": "1234567890123", "confirm_password": "1234567890123"},
        {"confirm_password": "different-pass-99"},
        {"accept_terms": False},
        {"email": "not-an-email"},
        {"full_name": "A"},
        {"password": "password1234", "confirm_password": "password1234"},
    ],
)
def test_register_validation(client, over):
    assert register(client, **over).status_code == 422
    with SessionLocal() as db:
        assert db.scalars(select(User)).all() == []


def test_registration_cannot_claim_the_legacy_address(client):
    assert register(client, email="legacy@researchforge.invalid").status_code == 422


# ------------------------------------------------------------------ login / logout
def test_login_success(client, make_client):
    register(client)
    other = make_client()
    r = login(other)
    assert r.status_code == 200 and r.json()["state"] == "user"
    assert other.get("/api/projects").status_code == 200


def test_login_wrong_password_and_unknown_user_look_identical(client, make_client):
    register(client)
    wrong = login(make_client(), password="wrong-password-1")
    unknown = login(make_client(), email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() and error_code(wrong) == "invalid_credentials"
    assert "set-cookie" not in wrong.headers


def test_remember_me_controls_refresh_cookie_lifetime(client, make_client):
    register(client)
    short = login(make_client(), remember_me=False)
    long = login(make_client(), remember_me=True)
    refresh = lambda r: next(c for c in r.headers.get_list("set-cookie") if c.startswith("rf_refresh="))
    assert "max-age" not in refresh(short).lower()  # browser-session cookie
    assert "max-age=2592000" in refresh(long).lower()  # 30 days
    with SessionLocal() as db:
        flags = sorted(db.scalars(select(RefreshSession.persistent)).all())
        assert flags == [False, False, True]  # register + short + long


def test_logout_clears_session_and_revokes_refresh_token(client, make_client):
    register(client)
    stolen_refresh = client.cookies.get("rf_refresh")
    r = client.post("/api/auth/logout")
    assert r.status_code == 204
    assert client.get("/api/auth/session").json()["state"] == "anonymous"
    assert client.get("/api/projects").status_code == 401
    # even a copy of the old refresh cookie no longer works
    thief = make_client()
    thief.cookies.set("rf_refresh", stolen_refresh, path="/api/auth")
    assert thief.post("/api/auth/refresh").status_code == 401


def test_logout_is_idempotent(client):
    assert client.post("/api/auth/logout").status_code == 204


# ------------------------------------------------------------------ session + refresh
def test_session_endpoint_transparently_refreshes_expired_access_token(client):
    register(client)
    client.cookies.delete("rf_access")  # simulate the 15-minute access token expiring
    assert client.get("/api/projects").status_code == 401
    s = client.get("/api/auth/session")
    assert s.json()["state"] == "user" and "rf_access=" in s.headers["set-cookie"]
    assert client.get("/api/projects").status_code == 200


def test_refresh_rotates_and_reuse_after_grace_revokes_family(client, make_client):
    register(client)
    old = client.cookies.get("rf_refresh")
    assert client.post("/api/auth/refresh").status_code == 200
    new = client.cookies.get("rf_refresh")
    assert new and new != old

    # age the rotation beyond the grace window, then replay the OLD token (token theft)
    with SessionLocal() as db:
        db.execute(update(RefreshSession).where(RefreshSession.rotated_at.is_not(None)).values(rotated_at=utcnow().replace(year=2020)))
        db.commit()
    thief = make_client()
    thief.cookies.set("rf_refresh", old, path="/api/auth")
    assert thief.post("/api/auth/refresh").status_code == 401
    # the legitimate (newer) token in the same family is now revoked too
    victim = make_client()
    victim.cookies.set("rf_refresh", new, path="/api/auth")
    assert victim.post("/api/auth/refresh").status_code == 401


def test_refresh_reuse_inside_grace_is_rejected_but_does_not_revoke(client, make_client):
    register(client)
    old = client.cookies.get("rf_refresh")
    client.post("/api/auth/refresh")
    new = client.cookies.get("rf_refresh")
    racer = make_client()
    racer.cookies.set("rf_refresh", old, path="/api/auth")
    assert racer.post("/api/auth/refresh").status_code == 401
    assert client.cookies.get("rf_refresh") == new
    assert client.post("/api/auth/refresh").status_code == 200  # family still alive


def test_refresh_without_cookie_is_401(client):
    r = client.post("/api/auth/refresh")
    assert r.status_code == 401 and error_code(r) == "session_expired"


def test_tampered_access_cookie_is_ignored(client):
    register(client)
    client.cookies.set("rf_access", "x.y.z")
    client.cookies.delete("rf_refresh", path="/api/auth")
    assert client.get("/api/auth/session").json()["state"] == "anonymous"


def test_disabled_legacy_account_cannot_log_in(client):
    with SessionLocal() as db:
        db.add(User(full_name="Legacy", email="legacy@researchforge.invalid", password_hash="!disabled", is_active=False))
        db.commit()
    r = login(client, email="legacy@researchforge.invalid", password="anything-12345")
    assert r.status_code in (401, 422)  # .invalid fails email validation; either way no session
    assert "set-cookie" not in r.headers


# ------------------------------------------------------------------ unauthorised access
@pytest.mark.parametrize(
    "method,path",
    [("get", "/api/projects"), ("post", "/api/projects"), ("get", "/api/projects/1"),
     ("put", "/api/projects/1"), ("delete", "/api/projects/1"), ("post", "/api/auth/resend-verification")],
)
def test_anonymous_requests_are_rejected(client, method, path):
    r = getattr(client, method)(path, **({"json": {}} if method in ("post", "put") else {}))
    assert r.status_code in (401, 422)
    if r.status_code == 401:
        assert error_code(r) == "not_authenticated"


def test_anonymous_session_state(client):
    assert client.get("/api/auth/session").json() == {
        "state": "anonymous", "user": None, "trial": None, "claimed_projects": 0, "verification_required": False,
    }


# ------------------------------------------------------------------ email verification
def test_email_verification_flow(client):
    register(client)
    assert client.get("/api/auth/session").json()["user"]["is_verified"] is False
    token = last_token("ada@example.com", "verify")
    # raw token is never stored
    with SessionLocal() as db:
        from app.models import AuthToken

        assert token not in db.scalars(select(AuthToken.token_hash)).all()
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 200
    assert client.get("/api/auth/session").json()["user"]["is_verified"] is True
    again = client.post("/api/auth/verify-email", json={"token": token})  # single use
    assert again.status_code == 400 and error_code(again) == "invalid_token"


def test_verification_rejects_garbage_and_expired_tokens(client):
    register(client)
    assert client.post("/api/auth/verify-email", json={"token": "x" * 40}).status_code == 400
    token = last_token("ada@example.com", "verify")
    with SessionLocal() as db:
        from app.models import AuthToken

        db.execute(update(AuthToken).values(expires_at=utcnow().replace(year=2020)))
        db.commit()
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400


def test_resend_verification_invalidates_old_link(client):
    register(client)
    first = last_token("ada@example.com", "verify")
    assert client.post("/api/auth/resend-verification").status_code == 200
    second = last_token("ada@example.com", "verify")
    assert first != second
    assert client.post("/api/auth/verify-email", json={"token": first}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": second}).status_code == 200


def test_required_verification_blocks_login_until_verified(client, make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "require_email_verification", True)
    r = register(client)
    assert r.status_code == 201 and r.json()["verification_required"] is True
    assert "set-cookie" not in r.headers
    blocked = login(make_client())
    assert blocked.status_code == 403 and error_code(blocked) == "email_not_verified"
    make_client().post("/api/auth/verify-email", json={"token": last_token("ada@example.com", "verify")})
    assert login(make_client()).status_code == 200


# ------------------------------------------------------------------ password reset
def test_forgot_password_does_not_reveal_whether_account_exists(client, make_client):
    register(client)
    mailer.OUTBOX.clear()
    known = make_client().post("/api/auth/forgot-password", json={"email": "ada@example.com"})
    n_after_known = len(mailer.OUTBOX)
    unknown = make_client().post("/api/auth/forgot-password", json={"email": "ghost@example.com"})
    assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
    assert n_after_known == 1 and len(mailer.OUTBOX) == 1  # only the real account got mail


def test_password_reset_flow_revokes_all_sessions(client, make_client):
    register(client)
    old_access = client.cookies.get("rf_access")
    old_refresh = client.cookies.get("rf_refresh")
    make_client().post("/api/auth/forgot-password", json={"email": "ada@example.com"})
    token = last_token("ada@example.com", "reset")

    weak = make_client().post("/api/auth/reset-password", json={"token": token, "password": "short"})
    assert weak.status_code == 422  # weak password does not burn the token

    new_pw = "brand-new-pass-77"
    ok = make_client().post("/api/auth/reset-password", json={"token": token, "password": new_pw})
    assert ok.status_code == 200
    reuse = make_client().post("/api/auth/reset-password", json={"token": token, "password": "another-pass-88"})
    assert reuse.status_code == 400  # single use

    assert login(make_client(), password=PASSWORD).status_code == 401  # old password dead
    assert login(make_client(), password=new_pw).status_code == 200

    # sessions that existed before the reset are dead (access token version + refresh revoked)
    attacker = make_client()
    attacker.cookies.set("rf_access", old_access)
    attacker.cookies.set("rf_refresh", old_refresh, path="/api/auth")
    assert attacker.get("/api/projects").status_code == 401
    assert attacker.post("/api/auth/refresh").status_code == 401


def test_reset_token_cannot_be_used_for_verification(client, make_client):
    register(client)
    make_client().post("/api/auth/forgot-password", json={"email": "ada@example.com"})
    token = last_token("ada@example.com", "reset")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400


def test_register_payload_helper_is_valid():
    assert register_payload()["accept_terms"] is True
