"""CSRF protection for cookie-authenticated, state-changing API calls.

Three independent layers (any one failing blocks the request):
 1. SameSite cookies (Lax by default) — browsers won't attach them to cross-site POSTs.
 2. Origin / Referer check — if a browser sends them, they must be an allowed origin.
 3. Required custom header `X-Requested-With: ResearchForge` — a cross-site page cannot add a
    custom header without passing a CORS preflight, which only allowed origins pass.
Safe methods (GET/HEAD/OPTIONS) are never state-changing in this API and are exempt.
"""
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.config import get_settings

CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "ResearchForge"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _origin_of(value: str) -> str:
    p = urlsplit(value)
    return f"{p.scheme}://{p.netloc}" if p.scheme and p.netloc else ""


def _deny(message: str) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": {"code": "csrf_failed", "message": message}})


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method not in SAFE_METHODS and request.url.path.startswith("/api/"):
            if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
                return _deny("Missing or invalid X-Requested-With header.")
            origin = request.headers.get("origin") or _origin_of(request.headers.get("referer", ""))
            if origin and _origin_of(origin) not in get_settings().allowed_origins:
                return _deny("Request origin is not allowed.")
        return await call_next(request)
