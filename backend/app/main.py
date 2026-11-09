import logging

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.routes import auth, guest, literature, memory, projects
from app.core.config import get_settings
from app.core.csrf import CSRFMiddleware
from app.core.database import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

settings = get_settings()  # fails fast if SECRET_KEY is missing/short

app = FastAPI(title="ResearchForge API", version="0.2.0")

# Middleware order: the LAST one added is the OUTERMOST. CSRF is added first so CORS wraps it,
# which means even CSRF rejections carry correct CORS headers for the browser to read.
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Requested-With"],
)

app.include_router(auth.router)
app.include_router(guest.router)
app.include_router(projects.router)
app.include_router(literature.router)
app.include_router(memory.router)


@app.get("/api/health", tags=["system"])
def health() -> dict[str, Any]:
    """API and database connectivity (used by the UI status indicator) plus which optional services are
    configured. Only booleans / mode names are reported, never key values."""
    from app.core.mailer import mail_mode
    from app.services import discovery

    cfg = {"email": mail_mode(), "literature_keys": [p.id for p in discovery.PROVIDERS if p.has_key()]}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected", **cfg}
    except Exception:
        logging.getLogger(__name__).exception("health check: database unreachable")
        return {"status": "degraded", "database": "unreachable", **cfg}
