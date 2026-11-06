from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Project(Base):
    """A research project, owned by EXACTLY one of: a registered user or a guest session.

    - owner_user_id  -> users.id          (ON DELETE CASCADE: deleting an account removes its data)
    - guest_session_id -> guest_sessions.id (ON DELETE RESTRICT: a guest project is never silently
      lost when the guest session row expires/cleans up; it gets claimed on registration)
    - CHECK enforces exactly one owner type; the partial unique index is the database-level
      backstop for "one trial project per guest session" even if application code has a bug.
    """

    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(owner_user_id, guest_session_id) = 1",
            name="ck_projects_exactly_one_owner",
        ),
        Index(
            "uq_projects_guest_session_id",
            "guest_session_id",
            unique=True,
            postgresql_where=text("guest_session_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", name="fk_projects_owner_user_id_users"),
        nullable=True,
        index=True,
    )
    guest_session_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "guest_sessions.id", ondelete="RESTRICT", name="fk_projects_guest_session_id_guest_sessions"
        ),
        nullable=True,
    )
    research_question: Mapped[str] = mapped_column(Text, nullable=False)
    modality: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    disease: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    objectives: Mapped[list[str]] = mapped_column(
        ARRAY(String(128)), nullable=False, default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
