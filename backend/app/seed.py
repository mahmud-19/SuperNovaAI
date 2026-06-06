from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.models import User, UserRole, RetrainingState


DEMO_USERS = [
    {
        "full_name": "Admin",
        "email": "admin@supernova.com",
        "username": "admin",
        "password": "123456789",
        "role": UserRole.admin,
    },
]


def seed_demo_users(db: Session) -> None:
    for demo in DEMO_USERS:
        existing = db.scalar(select(User).where(User.email == demo["email"]))
        if existing:
            continue
        db.add(
            User(
                full_name=demo["full_name"],
                email=demo["email"],
                username=demo["username"],
                hashed_password=hash_password(demo["password"]),
                role=demo["role"],
            )
        )
    db.commit()

    # Seed RetrainingState
    state = db.scalar(select(RetrainingState).where(RetrainingState.id == 1))
    if not state:
        db.add(RetrainingState(id=1, approved_since_last_retrain=0))
        db.commit()
