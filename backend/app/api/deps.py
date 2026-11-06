"""Request identity: who is calling — a registered user, a guest, or nobody."""
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import api_error
from app.core.security import (
    ACCESS_COOKIE,
    GUEST_COOKIE,
    decode_access_token,
    hash_token,
    unsign_guest_token,
    utcnow,
)
from app.models import GuestSession, User


@dataclass(frozen=True)
class Identity:
    user: User | None = None
    guest: GuestSession | None = None


def user_from_request(db: Session, request: Request) -> User | None:
    decoded = decode_access_token(request.cookies.get(ACCESS_COOKIE))
    if decoded is None:
        return None
    user_id, version = decoded
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.auth_version != version:
        return None
    return user


def guest_from_request(db: Session, request: Request) -> GuestSession | None:
    """Cookie signature is checked first, then the token hash is validated against PostgreSQL."""
    raw = unsign_guest_token(request.cookies.get(GUEST_COOKIE))
    if raw is None:
        return None
    guest = db.scalar(select(GuestSession).where(GuestSession.token_hash == hash_token(raw)))
    if guest is None or guest.expires_at <= utcnow():
        return None
    return guest


def get_identity(request: Request, db: Session = Depends(get_db)) -> Identity:
    user = user_from_request(db, request)
    if user is not None:
        return Identity(user=user)
    return Identity(guest=guest_from_request(db, request))


def require_identity(identity: Identity = Depends(get_identity)) -> Identity:
    if identity.user is None and identity.guest is None:
        raise api_error(401, "not_authenticated", "Sign in or start the free trial to continue.")
    return identity


def require_user(identity: Identity = Depends(get_identity)) -> User:
    if identity.user is None:
        raise api_error(401, "not_authenticated", "Please sign in to continue.")
    return identity.user
