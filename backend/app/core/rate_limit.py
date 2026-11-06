"""In-memory sliding-window rate limiter.

LIMITATION (documented in README): state lives in this process. That is correct for the
single-process localhost deployment this project targets; with several workers/instances each
has its own counters, so move this to Redis (or a DB table) before scaling out.
"""
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import api_error

_lock = threading.Lock()
_hits: dict[tuple[str, str], deque[float]] = {}


def reset_limits() -> None:
    with _lock:
        _hits.clear()


def check(name: str, key: str, limit: int, window_seconds: int) -> None:
    """Record a hit; raise 429 if more than `limit` hits happened in the window."""
    if not get_settings().rate_limit_enabled:
        return
    now = time.monotonic()
    with _lock:
        q = _hits.setdefault((name, key), deque())
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            retry = max(1, int(window_seconds - (now - q[0])) + 1)
            raise api_error(
                429,
                "rate_limited",
                f"Too many attempts. Please try again in {retry} seconds.",
                headers={"Retry-After": str(retry)},
            )
        q.append(now)
        if len(_hits) > 20000:  # opportunistic pruning
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
                _hits.pop(k, None)


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def ip_limit(name: str, limit: int, window_seconds: int) -> Callable[[Request], None]:
    """FastAPI dependency factory: per-client-IP limit."""

    def dep(request: Request) -> None:
        check(name, client_ip(request), limit, window_seconds)

    return dep
