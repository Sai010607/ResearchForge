"""Research project CRUD — every operation is authorised against the caller's identity.

Rules
- Registered users: full CRUD on THEIR projects only (other users' ids return 404, never 403,
  so project ids cannot be probed).
- Guests: may create exactly one project (atomic, DB-enforced), and read it back. They cannot
  edit or delete (their first project is never lost to a guest action).
- Anonymous callers: 401.
"""
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Identity, require_identity, require_user
from app.core import rate_limit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import api_error
from app.core.security import utcnow
from app.models import GuestSession, Project, User
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/api/projects", tags=["projects"])

TRIAL_EXHAUSTED = (
    "trial_exhausted",
    "Your free research project has been used. Create a free account to keep building.",
)


def _owned_filter(identity: Identity):
    if identity.user is not None:
        return Project.owner_user_id == identity.user.id
    return Project.guest_session_id == identity.guest.id  # type: ignore[union-attr]


def _get_owned_or_404(db: Session, identity: Identity, project_id: int) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id, _owned_filter(identity)))
    if project is None:
        raise api_error(404, "not_found", "Project not found")
    return project


def _create_for_user(db: Session, user: User, payload: ProjectCreate) -> Project:
    s = get_settings()
    rate_limit.check("project-create", str(user.id), s.project_creates_per_hour, 3600)
    count = db.scalar(select(func.count()).select_from(Project).where(Project.owner_user_id == user.id))
    if (count or 0) >= s.max_projects_per_user:
        raise api_error(403, "project_limit_reached", f"You have reached the limit of {s.max_projects_per_user} projects.")
    project = Project(**payload.model_dump(), owner_user_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def _create_for_guest(db: Session, guest_id: int, payload: ProjectCreate) -> Project:
    """Consume the trial atomically.

    Body validation already happened (422) before this function runs, so invalid requests can
    never reach here. The row lock + same-transaction update + partial unique index mean two
    concurrent requests cannot both succeed; a failure anywhere rolls back and leaves the trial
    unused.
    """
    guest = db.scalar(
        select(GuestSession)
        .where(GuestSession.id == guest_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if guest is None or guest.expires_at <= utcnow():
        raise api_error(401, "not_authenticated", "Your trial session expired. Please reload the page.")
    if guest.trial_used:
        raise api_error(403, *TRIAL_EXHAUSTED)
    project = Project(**payload.model_dump(), guest_session_id=guest.id)
    db.add(project)
    guest.trial_used = True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(403, *TRIAL_EXHAUSTED)
    db.refresh(project)
    return project


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    identity: Identity = Depends(require_identity),
    db: Session = Depends(get_db),
) -> Project:
    if identity.user is not None:
        return _create_for_user(db, identity.user, payload)
    return _create_for_guest(db, identity.guest.id, payload)  # type: ignore[union-attr]


@router.get("", response_model=list[ProjectRead])
def list_projects(
    identity: Identity = Depends(require_identity), db: Session = Depends(get_db)
) -> list[Project]:
    stmt = select(Project).where(_owned_filter(identity)).order_by(Project.created_at.desc(), Project.id.desc())
    return list(db.scalars(stmt))


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: int, identity: Identity = Depends(require_identity), db: Session = Depends(get_db)
) -> Project:
    return _get_owned_or_404(db, identity, project_id)


@router.put("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> Project:
    project = _get_owned_or_404(db, Identity(user=user), project_id)
    for key, value in payload.model_dump().items():
        setattr(project, key, value)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> Response:
    project = _get_owned_or_404(db, Identity(user=user), project_id)
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
