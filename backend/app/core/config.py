"""Application settings, loaded from environment variables / backend/.env."""
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _origin(url: str) -> str:
    parts = urlsplit(url.strip())
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+psycopg://researchforge:researchforge@localhost:5432/researchforge"
    )
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    frontend_url: str = "http://localhost:3000"
    environment: Literal["development", "test", "production"] = "development"

    # --- secrets (NO default on purpose: the app refuses to start without one) ---
    secret_key: str = Field(min_length=32)

    # --- cookies / sessions ---
    cookie_secure: bool = False  # must be true in production (HTTPS)
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    access_token_minutes: int = 15
    refresh_days_remember: int = 30
    refresh_hours_session: int = 24
    guest_session_days: int = 180
    verification_hours: int = 48
    reset_minutes: int = 30

    # --- policy ---
    require_email_verification: bool = False
    max_projects_per_user: int = 200
    project_creates_per_hour: int = 30
    max_papers_per_project: int = 200
    literature_searches_per_hour: int = 60

    # --- literature sources (OpenAlex asks for a contact email: it moves you to their faster pool) ---
    contact_email: str = ""
    literature_timeout_seconds: float = 10.0

    # --- abuse protection ---
    rate_limit_enabled: bool = True
    trust_proxy_headers: bool = False  # only behind a proxy you control

    # --- Argon2id cost (OWASP baseline: m=19MiB,t=2,p=1; defaults are stronger) ---
    argon2_time_cost: int = 3
    argon2_memory_kib: int = 65536
    argon2_parallelism: int = 4

    # --- email (leave smtp_host empty to use the console/log mailer) ---
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    mail_from: str = "ResearchForge <no-reply@researchforge.local>"

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        if self.environment == "production":
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true when ENVIRONMENT=production")
            if not self.frontend_url.startswith("https://"):
                raise ValueError("FRONTEND_URL must be https:// when ENVIRONMENT=production")
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_origins(self) -> set[str]:
        """Origins allowed to make credentialed / state-changing requests."""
        origins = {_origin(o) for o in self.cors_origin_list}
        origins.add(_origin(self.frontend_url))
        origins.discard("")
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
