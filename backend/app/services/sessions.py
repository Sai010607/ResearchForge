"""Cookie + refresh-session management and guest-project claiming."""
import uuid
from datetime import timedelta

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import guest_from_request
from app.core.config import get_settings
from app.core.security import (
    ACCESS_COOKIE,
    GUEST_COOKIE,
    REFRESH_COOKIE,
    create_access_token,
    hash_token,
    new_token,
    sign_guest_token,
    utcnow,
)
from app.models import GuestSession, Project, RefreshSession, User

REFRESH_GRACE = timedelta(seconds=10)  # tolerates two tabs refreshing at the same instant


def _cookie_kwargs() -> dict:
    s = get_settings()
    return {"httponly": True, "secure": s.cookie_secure, "samesite": s.cookie_samesite}


def set_access_cookie(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        ACCESS_COOKIE,
        create_access_token(user.id, user.auth_version),
        max_age=s.access_token_minutes * 60,
        path="/",
        **_cookie_kwargs(),
    )


def issue_session(
    db: Session, response: Response, user: User, *, remember: bool, family_id: str | None = None
) -> None:
    """Create a refresh session row and set both cookies. Caller commits."""
    s = get_settings()
    lifetime = timedelta(days=s.refresh_days_remember) if remember else timedelta(
        hours=s.refresh_hours_session
    )
    raw = new_token()
    db.add(
        RefreshSession(
            user_id=user.id,
            token_hash=hash_token(raw),
            family_id=family_id or str(uuid.uuid4()),
            persistent=remember,
            expires_at=utcnow() + lifetime,
        )
    )
    set_access_cookie(response, user)
    # Path is limited to /api/auth so the long-lived token is never sent with ordinary API calls.
    response.set_cookie(
        REFRESH_COOKIE,
        raw,
        max_age=int(lifetime.total_seconds()) if remember else None,  # None = browser-session cookie
        path="/api/auth",
        **_cookie_kwargs(),
    )


def clear_auth_cookies(response: Response) -> None:
    s = get_settings()
    kw = {"httponly": True, "secure": s.cookie_secure, "samesite": s.cookie_samesite}
    response.delete_cookie(ACCESS_COOKIE, path="/", **kw)
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth", **kw)


def clear_guest_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(
        GUEST_COOKIE, path="/", httponly=True, secure=s.cookie_secure, samesite=s.cookie_samesite
    )


def set_guest_cookie(response: Response, raw_token: str) -> None:
    s = get_settings()
    response.set_cookie(
        GUEST_COOKIE,
        sign_guest_token(raw_token),
        max_age=s.guest_session_days * 86400,
        path="/",
        **_cookie_kwargs(),
    )


def extend_guest_cookie(response: Response, request: Request) -> None:
    """Re-issue the visitor's existing (already verified) cookie value with a fresh max-age."""
    value = request.cookies.get(GUEST_COOKIE)
    if value:
        response.set_cookie(
            GUEST_COOKIE,
            value,
            max_age=get_settings().guest_session_days * 86400,
            path="/",
            **_cookie_kwargs(),
        )


def revoke_family(db: Session, family_id: str) -> None:
    db.execute(
        update(RefreshSession)
        .where(RefreshSession.family_id == family_id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def revoke_all_for_user(db: Session, user_id: int) -> None:
    db.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user_id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def rotate_refresh(db: Session, request: Request, response: Response) -> User | None:
    """Validate + rotate the refresh cookie. Returns the user, or None if not valid.

    Reuse of an already-rotated token outside the grace window revokes the entire family.
    Caller commits.
    """
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        return None
    rs = db.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw)).with_for_update()
    )
    now = utcnow()
    if rs is None or rs.revoked_at is not None or rs.expires_at <= now:
        return None
    if rs.rotated_at is not None:
        if now - rs.rotated_at > REFRESH_GRACE:
            revoke_family(db, rs.family_id)  # looks like a stolen/replayed token
        return None
    user = db.get(User, rs.user_id)
    if user is None or not user.is_active:
        return None
    rs.rotated_at = now
    issue_session(db, response, user, remember=rs.persistent, family_id=rs.family_id)
    return user


def claim_guest_projects(db: Session, user: User, request: Request, response: Response) -> int:
    """Move the visitor's trial project(s) onto the account, then retire the guest cookie."""
    guest = guest_from_request(db, request)
    if guest is None:
        return 0
    result = db.execute(
        update(Project)
        .where(Project.guest_session_id == guest.id)
        .values(owner_user_id=user.id, guest_session_id=None)
    )
    clear_guest_cookie(response)
    return result.rowcount or 0


def create_guest_session(db: Session, response: Response) -> GuestSession:
    s = get_settings()
    raw = new_token()
    guest = GuestSession(
        token_hash=hash_token(raw), expires_at=utcnow() + timedelta(days=s.guest_session_days)
    )
    db.add(guest)
    db.flush()
    set_guest_cookie(response, raw)
    return guest
