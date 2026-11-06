from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Identity, get_identity, guest_from_request, require_user
from app.core import rate_limit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import api_error
from app.core.mailer import send_password_reset_email, send_verification_email
from app.core.security import (
    REFRESH_COOKIE,
    burn_password_time,
    hash_password,
    hash_token,
    new_token,
    password_needs_rehash,
    utcnow,
    verify_password,
)
from app.models import AuthToken, RefreshSession, User
from app.schemas.auth import (
    EmailIn,
    LoginIn,
    MessageOut,
    RegisterIn,
    ResetPasswordIn,
    SessionRead,
    TokenIn,
    TrialStatus,
    UserRead,
)
from app.services import sessions as svc

router = APIRouter(prefix="/api/auth", tags=["auth"])

VERIFY = "verify_email"
RESET = "reset_password"


# ------------------------------------------------------------------ helpers
def _email_key(email: str) -> str:
    return hash_token(email.strip().lower())[:32]


def trial_status(used: bool) -> TrialStatus:
    return TrialStatus(limit=1, used=1 if used else 0, remaining=0 if used else 1, exhausted=used)


def session_for(identity: Identity, **extra) -> SessionRead:
    if identity.user is not None:
        return SessionRead(state="user", user=UserRead.model_validate(identity.user), **extra)
    if identity.guest is not None:
        return SessionRead(state="guest", trial=trial_status(identity.guest.trial_used), **extra)
    return SessionRead(state="anonymous", **extra)


def _issue_token(db: Session, user: User, purpose: str, lifetime: timedelta) -> str:
    """Invalidate older unused tokens of this purpose, then mint a fresh single-use one."""
    db.execute(
        update(AuthToken)
        .where(AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    raw = new_token()
    db.add(
        AuthToken(
            user_id=user.id, purpose=purpose, token_hash=hash_token(raw), expires_at=utcnow() + lifetime
        )
    )
    return raw


def _consume_token(db: Session, raw: str, purpose: str) -> User:
    tok = db.scalar(
        select(AuthToken)
        .where(AuthToken.token_hash == hash_token(raw), AuthToken.purpose == purpose)
        .with_for_update()
    )
    if tok is None or tok.used_at is not None or tok.expires_at <= utcnow():
        raise api_error(400, "invalid_token", "This link is invalid or has expired. Please request a new one.")
    user = db.get(User, tok.user_id)
    if user is None or not user.is_active:
        raise api_error(400, "invalid_token", "This link is invalid or has expired. Please request a new one.")
    tok.used_at = utcnow()
    return user


# ------------------------------------------------------------------ register / login
@router.post(
    "/register",
    response_model=SessionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit.ip_limit("register", 5, 3600))],
)
def register(
    payload: RegisterIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SessionRead:
    s = get_settings()
    email = str(payload.email).strip().lower()
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise api_error(409, "email_taken", "An account with this email already exists. Try signing in instead.")
    user = User(
        full_name=payload.full_name,
        email=email,
        password_hash=hash_password(payload.password),
        is_verified=False,
        terms_accepted_at=utcnow(),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # lost a race with a concurrent identical registration
        db.rollback()
        raise api_error(409, "email_taken", "An account with this email already exists. Try signing in instead.")

    token = _issue_token(db, user, VERIFY, timedelta(hours=s.verification_hours))
    background.add_task(send_verification_email, email, user.full_name, token)

    if s.require_email_verification:
        db.commit()
        return SessionRead(state="anonymous", verification_required=True)

    claimed = svc.claim_guest_projects(db, user, request, response)
    svc.issue_session(db, response, user, remember=False)
    db.commit()
    return session_for(Identity(user=user), claimed_projects=claimed)


@router.post(
    "/login",
    response_model=SessionRead,
    dependencies=[Depends(rate_limit.ip_limit("login-ip", 10, 60))],
)
def login(
    payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> SessionRead:
    s = get_settings()
    email = str(payload.email).strip().lower()
    rate_limit.check("login-email", _email_key(email), 8, 300)

    user = db.scalar(select(User).where(User.email == email))
    ok = False
    if user is not None and user.is_active:
        ok = verify_password(user.password_hash, payload.password)
    else:
        burn_password_time(payload.password)  # equalise timing for unknown / disabled accounts
    if not ok or user is None:
        # One message for "no such user" and "wrong password": no account enumeration.
        raise api_error(401, "invalid_credentials", "Incorrect email or password.")
    if s.require_email_verification and not user.is_verified:
        raise api_error(403, "email_not_verified", "Please verify your email before signing in.")

    if password_needs_rehash(user.password_hash):  # transparently upgrade cost parameters
        user.password_hash = hash_password(payload.password)

    claimed = svc.claim_guest_projects(db, user, request, response)
    svc.issue_session(db, response, user, remember=payload.remember_me)
    db.commit()
    return session_for(Identity(user=user), claimed_projects=claimed)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        rs = db.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw)))
        if rs is not None:
            svc.revoke_family(db, rs.family_id)
            db.commit()
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    svc.clear_auth_cookies(resp)
    return resp


@router.post("/refresh", response_model=SessionRead)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    user = svc.rotate_refresh(db, request, response)
    db.commit()
    if user is None:
        fail = JSONResponse(
            status_code=401,
            content={"detail": {"code": "session_expired", "message": "Your session has expired. Please sign in again."}},
        )
        svc.clear_auth_cookies(fail)
        return fail
    return session_for(Identity(user=user))


@router.get("/session", response_model=SessionRead)
def current_session(
    request: Request,
    response: Response,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> SessionRead:
    """Single source of truth for the UI. Transparently refreshes an expired access token."""
    if identity.user is None and request.cookies.get(REFRESH_COOKIE):
        user = svc.rotate_refresh(db, request, response)
        db.commit()
        if user is not None:
            return session_for(Identity(user=user))
        svc.clear_auth_cookies(response)
    return session_for(identity)


# ------------------------------------------------------------------ email verification
@router.post("/verify-email", response_model=MessageOut, dependencies=[Depends(rate_limit.ip_limit("verify", 20, 3600))])
def verify_email(payload: TokenIn, db: Session = Depends(get_db)) -> MessageOut:
    user = _consume_token(db, payload.token, VERIFY)
    user.is_verified = True
    db.commit()
    return MessageOut(message="Email verified.")


@router.post("/resend-verification", response_model=MessageOut)
def resend_verification(
    background: BackgroundTasks, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> MessageOut:
    rate_limit.check("resend-verification", str(user.id), 3, 3600)
    if not user.is_verified:
        token = _issue_token(db, user, VERIFY, timedelta(hours=get_settings().verification_hours))
        db.commit()
        background.add_task(send_verification_email, user.email, user.full_name, token)
    return MessageOut(message="If your email is not yet verified, a new link is on its way.")


# ------------------------------------------------------------------ password reset
@router.post(
    "/forgot-password",
    response_model=MessageOut,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit.ip_limit("forgot-ip", 5, 3600))],
)
def forgot_password(
    payload: EmailIn, background: BackgroundTasks, db: Session = Depends(get_db)
) -> MessageOut:
    email = str(payload.email).strip().lower()
    generic = MessageOut(message="If an account exists for that email, a reset link is on its way.")
    try:
        rate_limit.check("forgot-email", _email_key(email), 3, 3600)
    except HTTPException:
        return generic  # never reveal per-address throttling
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.is_active:
        token = _issue_token(db, user, RESET, timedelta(minutes=get_settings().reset_minutes))
        db.commit()
        background.add_task(send_password_reset_email, user.email, user.full_name, token)
    return generic


@router.post(
    "/reset-password",
    response_model=MessageOut,
    dependencies=[Depends(rate_limit.ip_limit("reset-ip", 10, 3600))],
)
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)) -> MessageOut:
    user = _consume_token(db, payload.token, RESET)
    user.password_hash = hash_password(payload.password)
    user.auth_version += 1  # kills any access token issued before the reset
    user.is_verified = True  # the reset link proved control of the mailbox
    svc.revoke_all_for_user(db, user.id)  # sign out every device
    db.commit()
    return MessageOut(message="Password updated. Please sign in with your new password.")
