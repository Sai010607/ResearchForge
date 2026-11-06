"""Hand the pre-authentication ("legacy") projects to a real account.

    python -m app.scripts.claim_legacy --email you@example.com

Migration 0002 parks projects created before authentication existed on a disabled system user so
they are not visible to every registered user. Run this once to assign them to yourself.
"""
import argparse
import sys

from sqlalchemy import select, update

from app.core.database import SessionLocal
from app.models import Project, User

LEGACY_EMAIL = "legacy@researchforge.invalid"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="email of the registered account to receive the projects")
    args = parser.parse_args()
    email = args.email.strip().lower()

    with SessionLocal() as db:
        legacy = db.scalar(select(User).where(User.email == LEGACY_EMAIL))
        target = db.scalar(select(User).where(User.email == email))
        if legacy is None:
            print("No legacy projects exist - nothing to do.")
            return 0
        if target is None or not target.is_active or target.id == legacy.id:
            print(f"No active registered account found for {email}. Register first, then re-run.")
            return 1
        result = db.execute(
            update(Project).where(Project.owner_user_id == legacy.id).values(owner_user_id=target.id)
        )
        db.commit()
        print(f"Moved {result.rowcount} project(s) to {email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
