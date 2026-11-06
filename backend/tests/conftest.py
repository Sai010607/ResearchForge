"""Tests run against a REAL PostgreSQL (no mocks) in a SEPARATE database.

The dev database is never touched: tests use `<your db name>_test` (or TEST_DATABASE_URL). The
database is created and migrated to head automatically, and every table is truncated per test.
"""
import os
from pathlib import Path

# --- environment must be prepared BEFORE the app is imported -----------------------------------
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-0123456789-abcdefghijklmnop")
os.environ["ENVIRONMENT"] = "test"
os.environ["RATE_LIMIT_ENABLED"] = "false"  # individual tests switch it on explicitly
os.environ["REQUIRE_EMAIL_VERIFICATION"] = "false"
os.environ["ARGON2_TIME_COST"] = "1"  # keep Argon2id real but fast for the test-suite
os.environ["ARGON2_MEMORY_KIB"] = "8192"
os.environ["ARGON2_PARALLELISM"] = "1"

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.core.config import Settings  # noqa: E402

_dev_url = make_url(Settings().database_url)  # fresh instance: ignores the lru_cache
_test_url = make_url(
    os.environ.get("TEST_DATABASE_URL") or _dev_url.set(database=f"{_dev_url.database}_test").render_as_string(hide_password=False)
)
os.environ["DATABASE_URL"] = _test_url.render_as_string(hide_password=False)


def _ensure_test_database() -> None:
    admin = create_engine(_test_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": _test_url.database}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{_test_url.database}"'))
    admin.dispose()


_ensure_test_database()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

_backend = Path(__file__).resolve().parents[1]
_alembic_cfg = Config(str(_backend / "alembic.ini"))
_alembic_cfg.set_main_option("script_location", str(_backend / "alembic"))
command.upgrade(_alembic_cfg, "head")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core import mailer, rate_limit  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.database import engine  # noqa: E402
from app.main import app  # noqa: E402

CSRF_HEADERS = {"X-Requested-With": "ResearchForge"}


@pytest.fixture(autouse=True)
def _clean_state():
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE projects, auth_tokens, refresh_sessions, guest_sessions, users "
                "RESTART IDENTITY CASCADE"
            )
        )
    rate_limit.reset_limits()
    mailer.OUTBOX.clear()
    yield


@pytest.fixture()
def settings():
    return get_settings()


@pytest.fixture()
def make_client():
    """Factory: every client is an independent browser with its own cookie jar."""

    def _make(headers: dict | None = CSRF_HEADERS) -> TestClient:
        return TestClient(app, headers=headers or {})

    return _make


@pytest.fixture()
def client(make_client):
    return make_client()


@pytest.fixture()
def enable_rate_limit(monkeypatch, settings):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
