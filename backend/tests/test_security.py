import jwt
import pytest
from pydantic import ValidationError
from sqlalchemy import select, text

from app.core.config import Settings
from app.core.database import SessionLocal, engine
from app.core.security import (
    create_access_token,
    hash_password,
    sign_guest_token,
    unsign_guest_token,
    utcnow,
    verify_password,
)
from app.models import Project
from tests.helpers import VALID, error_code, register

# ------------------------------------------------------------------ CSRF
def test_state_changing_request_without_csrf_header_is_blocked(make_client):
    naked = make_client(headers={})
    r = naked.post("/api/guest/session")
    assert r.status_code == 403 and error_code(r) == "csrf_failed"


def test_cross_site_origin_is_blocked_even_with_header(client):
    r = client.post("/api/guest/session", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and error_code(r) == "csrf_failed"


def test_allowed_origin_passes_and_safe_methods_are_exempt(make_client):
    ok = make_client().post("/api/guest/session", headers={"Origin": "http://localhost:3000"})
    assert ok.status_code == 200
    assert make_client(headers={}).get("/api/health").status_code == 200


def test_csrf_rejections_still_carry_cors_headers(client):
    r = client.post("/api/guest/session", headers={"Origin": "http://localhost:3000", "X-Requested-With": "nope"})
    assert r.status_code == 403
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_cors_preflight_allows_only_known_origins_with_credentials(client):
    good = client.options(
        "/api/projects",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type,x-requested-with"},
    )
    assert good.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert good.headers["access-control-allow-credentials"] == "true"
    bad = client.options(
        "/api/projects",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in bad.headers


# ------------------------------------------------------------------ rate limiting
def test_login_is_rate_limited_per_ip(make_client, enable_rate_limit):
    register(make_client(), email="rl@example.com")  # first of the allowed registrations
    codes = [
        make_client().post("/api/auth/login", json={"email": f"x{i}@example.com", "password": "whatever-123"}).status_code
        for i in range(12)
    ]
    assert codes[:10] == [401] * 10 and codes[10:] == [429, 429]


def test_login_is_rate_limited_per_email_across_ips(make_client, enable_rate_limit, monkeypatch):
    from app.core import rate_limit

    codes = []
    for i in range(10):
        monkeypatch.setattr(rate_limit, "client_ip", lambda request, i=i: f"10.0.0.{i}")
        c = make_client()
        codes.append(c.post("/api/auth/login", json={"email": "victim@example.com", "password": "guess-number-1"}).status_code)
    # ip-limit dependency uses its own import of client_ip; the per-email limit (8/5min) must trip
    assert codes.count(401) == 8 and codes.count(429) == 2


def test_registration_is_rate_limited(make_client, enable_rate_limit):
    codes = [register(make_client(), email=f"u{i}@example.com").status_code for i in range(7)]
    assert codes[:5] == [201] * 5 and codes[5:] == [429, 429]


def test_forgot_password_is_rate_limited_but_never_leaks(make_client, enable_rate_limit):
    codes = [make_client().post("/api/auth/forgot-password", json={"email": "a@example.com"}).status_code for _ in range(6)]
    assert codes[:5] == [202] * 5 and codes[5] == 429  # per-IP cap; per-email cap stays silent (202)


# ------------------------------------------------------------------ tokens & hashing
def test_argon2id_hash_roundtrip_and_salting():
    h1, h2 = hash_password("some-long-pass-1"), hash_password("some-long-pass-1")
    assert h1 != h2 and h1.startswith("$argon2id$")
    assert verify_password(h1, "some-long-pass-1") and not verify_password(h1, "other")
    assert verify_password("!disabled", "anything") is False  # invalid hash never verifies


def test_jwt_signed_with_wrong_key_or_alg_none_is_rejected(client):
    register(client)
    forged = jwt.encode({"sub": "1", "iss": "researchforge", "ver": 0, "exp": utcnow().timestamp() + 600}, "wrong-key" * 5, algorithm="HS256")
    none_alg = jwt.encode({"sub": "1", "iss": "researchforge", "exp": utcnow().timestamp() + 600}, None, algorithm="none")
    for token in (forged, none_alg):
        c = type(client)(client.app, headers=dict(client.headers))
        c.cookies.set("rf_access", token)
        assert c.get("/api/projects").status_code == 401


def test_expired_access_token_is_rejected(client, monkeypatch, settings):
    register(client)
    monkeypatch.setattr(settings, "access_token_minutes", -1)
    client.cookies.set("rf_access", create_access_token(1, 0))
    client.cookies.delete("rf_refresh", path="/api/auth")
    assert client.get("/api/projects").status_code == 401


def test_guest_token_signature_roundtrip_and_tamper():
    signed = sign_guest_token("abc123")
    assert unsign_guest_token(signed) == "abc123"
    assert unsign_guest_token("abc124" + signed[6:]) is None
    assert unsign_guest_token("nodot") is None and unsign_guest_token(None) is None


# ------------------------------------------------------------------ configuration safety
def test_settings_refuse_missing_or_short_secret(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, secret_key="too-short")


def test_production_requires_secure_cookies_and_https():
    base = {"_env_file": None, "secret_key": "x" * 40, "environment": "production"}
    with pytest.raises(ValidationError):
        Settings(**base, cookie_secure=False, frontend_url="https://app.example.com")
    with pytest.raises(ValidationError):
        Settings(**base, cookie_secure=True, frontend_url="http://app.example.com")
    Settings(**base, cookie_secure=True, frontend_url="https://app.example.com")


# ------------------------------------------------------------------ migration safety
def test_migration_preserves_existing_projects_and_assigns_legacy_owner():
    """Downgrade to 0001, insert pre-auth rows, upgrade again: rows survive, owned by a disabled user."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    engine.dispose()
    command.downgrade(cfg, "0001")
    try:
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE projects RESTART IDENTITY"))
            for i in range(3):
                conn.execute(
                    text("INSERT INTO projects (research_question, modality, disease, objectives) VALUES (:q, 'fMRI', 'Brain Tumor', ARRAY['Prediction'])"),
                    {"q": f"Pre-auth research question number {i}"},
                )
        command.upgrade(cfg, "head")
        engine.dispose()
        with SessionLocal() as db:
            rows = db.execute(text("SELECT p.id, u.email, u.is_active FROM projects p JOIN users u ON u.id = p.owner_user_id ORDER BY p.id")).all()
            assert [r.email for r in rows] == ["legacy@researchforge.invalid"] * 3
            assert all(r.is_active is False for r in rows)
    finally:
        command.upgrade(cfg, "head")
        engine.dispose()
