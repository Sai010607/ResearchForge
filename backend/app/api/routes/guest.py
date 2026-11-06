from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import Identity, user_from_request, guest_from_request
from app.api.routes.auth import session_for
from app.core import rate_limit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import utcnow
from app.schemas.auth import SessionRead
from app.services import sessions as svc
from datetime import timedelta

router = APIRouter(prefix="/api/guest", tags=["guest"])


@router.post("/session", response_model=SessionRead)
def start_guest_session(
    request: Request, response: Response, db: Session = Depends(get_db)
) -> SessionRead:
    """Idempotent: returns the visitor's existing trial session, or issues a new signed one.

    New sessions are rate-limited per client IP (abuse protection). Existing valid sessions are
    never rate-limited so a legitimate visitor can always load the page.
    """
    user = user_from_request(db, request)
    if user is not None:
        return session_for(Identity(user=user))

    guest = guest_from_request(db, request)
    if guest is not None:
        # keep an active visitor's trial alive (sliding expiry)
        days = get_settings().guest_session_days
        if guest.expires_at - utcnow() < timedelta(days=days // 2):
            guest.expires_at = utcnow() + timedelta(days=days)
            svc.extend_guest_cookie(response, request)
            db.commit()
        return session_for(Identity(guest=guest))

    rate_limit.check("guest-new", rate_limit.client_ip(request), 10, 3600)
    guest = svc.create_guest_session(db, response)
    db.commit()
    return session_for(Identity(guest=guest))
