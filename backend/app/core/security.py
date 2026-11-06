"""Cryptographic helpers: Argon2id passwords, opaque tokens, JWT access tokens, signed guest tokens.

Design rules
- Passwords: Argon2id only. Plaintext is never stored or logged.
- Refresh / guest / email tokens: random 256-bit values; only their SHA-256 is stored in the DB.
  (SHA-256 is appropriate because the inputs are high-entropy random, not human-chosen.)
- Sub-keys for JWT and guest-cookie signing are derived from SECRET_KEY with HMAC labels so one
  leaked artefact type cannot be replayed as another.
"""
import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

JWT_ISSUER = "researchforge"
ACCESS_COOKIE = "rf_access"
REFRESH_COOKIE = "rf_refresh"
GUEST_COOKIE = "rf_guest"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _derive_key(label: str) -> bytes:
    return hmac.new(get_settings().secret_key.encode(), label.encode(), hashlib.sha256).digest()


# ---------------------------------------------------------------- passwords
@lru_cache
def _hasher() -> PasswordHasher:
    s = get_settings()
    return PasswordHasher(  # argon2-cffi defaults to Argon2id
        time_cost=s.argon2_time_cost,
        memory_cost=s.argon2_memory_kib,
        parallelism=s.argon2_parallelism,
    )


def hash_password(password: str) -> str:
    return _hasher().hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _hasher().verify(stored_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher().check_needs_rehash(stored_hash)
    except InvalidHashError:
        return False


@lru_cache
def _dummy_hash() -> str:
    return _hasher().hash("researchforge-timing-equaliser")


def burn_password_time(password: str) -> None:
    """Spend the same CPU as a real verify so unknown emails are not detectable by timing."""
    verify_password(_dummy_hash(), password)


# ---------------------------------------------------------------- opaque tokens
def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------- access JWT
def create_access_token(user_id: int, auth_version: int) -> str:
    now = utcnow()
    payload = {
        "iss": JWT_ISSUER,
        "sub": str(user_id),
        "ver": auth_version,
        "iat": now,
        "exp": now + timedelta(minutes=get_settings().access_token_minutes),
    }
    return jwt.encode(payload, _derive_key("jwt-access"), algorithm="HS256")


def decode_access_token(token: str | None) -> tuple[int, int] | None:
    """Return (user_id, auth_version) or None if missing/invalid/expired."""
    if not token:
        return None
    try:
        data = jwt.decode(
            token,
            _derive_key("jwt-access"),
            algorithms=["HS256"],
            issuer=JWT_ISSUER,
            options={"require": ["exp", "sub", "iss"]},
        )
        return int(data["sub"]), int(data.get("ver", 0))
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


# ---------------------------------------------------------------- guest cookie
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def sign_guest_token(raw: str) -> str:
    sig = hmac.new(_derive_key("guest-cookie"), raw.encode(), hashlib.sha256).digest()[:18]
    return f"{raw}.{_b64(sig)}"


def unsign_guest_token(value: str | None) -> str | None:
    """Verify the HMAC; returns the raw token (still must be looked up in the DB)."""
    if not value or "." not in value:
        return None
    raw, _, sig = value.rpartition(".")
    expected = sign_guest_token(raw).rpartition(".")[2]
    return raw if raw and hmac.compare_digest(sig, expected) else None
