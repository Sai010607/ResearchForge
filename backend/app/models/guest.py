from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class GuestSession(Base):
    """Server-side record of an anonymous visitor and their one-time trial.

    Only the SHA-256 of the random token is stored; the browser holds the raw token inside an
    HMAC-signed HttpOnly cookie.
    """

    __tablename__ = "guest_sessions"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_guest_sessions_token_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    trial_used: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
