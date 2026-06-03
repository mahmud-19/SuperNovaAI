from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_role, hash_password
from app.database import get_db
from app.models import User, UserRole
from app.schemas import AdminUserRead, UserCreate, UserUpdate

router = APIRouter(prefix="/admin", tags=["admin"])

@router.get("/users", response_model=list[AdminUserRead])
def list_users(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
) -> list[AdminUserRead]:
    """Return all non-admin users."""
    stmt = select(User).where(User.role != UserRole.admin).order_by(User.id.desc())
    return db.scalars(stmt).all()

@router.post("/users", response_model=AdminUserRead)
def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
) -> User:
    """Create a new non-admin user."""
    # Strict validation for missing or empty fields returning 400
    if not payload.full_name or not payload.full_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")
    if not payload.username or not payload.username.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username is required")
    if not payload.email or not payload.email.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required")
    if not payload.password or not payload.password.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required")
    if not payload.role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role is required")

    # Check email uniqueness
    existing_email = db.scalar(select(User).where(User.email == payload.email))
    if existing_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
        
    # Check username uniqueness
    existing_username = db.scalar(select(User).where(User.username == payload.username))
    if existing_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")

    user = User(
        full_name=payload.full_name,
        username=payload.username,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=UserRole(payload.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.put("/users/{user_id}", response_model=AdminUserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
) -> User:
    """Update a user's details."""
    user = db.get(User, user_id)
    if not user or user.role == UserRole.admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check email uniqueness
    existing_email = db.scalar(select(User).where(User.email == payload.email, User.id != user_id))
    if existing_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")

    # Check username uniqueness
    existing_username = db.scalar(select(User).where(User.username == payload.username, User.id != user_id))
    if existing_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")

    user.full_name = payload.full_name
    user.username = payload.username
    user.email = payload.email
    user.role = UserRole(payload.role)
    if payload.password:
        user.hashed_password = hash_password(payload.password)
        
    db.commit()
    db.refresh(user)
    return user

@router.delete("/users/{user_id}", response_model=AdminUserRead)
def delete_user(
    user_id: int,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
) -> User:
    """Hard delete a user."""
    user = db.get(User, user_id)
    if not user or user.role == UserRole.admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    db.delete(user)
    db.commit()
    return user

@router.get("/retraining/status")
def get_retraining_status(
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    from app.models import RetrainingState, RetrainingLog
    
    state = db.scalar(select(RetrainingState).where(RetrainingState.id == 1))
    count = state.approved_since_last_retrain if state else 0
    
    latest = db.scalar(
        select(RetrainingLog).order_by(RetrainingLog.created_at.desc()).limit(1)
    )
    
    latest_data = None
    if latest:
        latest_data = {
            "id": latest.id,
            "status": latest.status,
            "model_version_after": latest.model_version_after,
            "dice_after": latest.dice_after,
            "created_at": latest.created_at.isoformat() if latest.created_at else None,
            "completed_at": latest.completed_at.isoformat() if latest.completed_at else None,
        }
        
    return {
        "count": count,
        "latest_log": latest_data
    }

@router.post("/retrain/trigger")
def trigger_retraining(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_role(UserRole.admin)),
    db: Session = Depends(get_db),
):
    import uuid
    import time
    from app.models import RetrainingLog
    from retrain import run_retraining
    from app.config import get_settings

    # Check if a retraining log is already running
    running = db.scalar(
        select(RetrainingLog).where(RetrainingLog.status == "running").limit(1)
    )
    if running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A retraining run is already actively in progress",
        )

    # Create a new RetrainingLog row
    log_id = f"retrain_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    new_log = RetrainingLog(
        id=log_id,
        status="running",
    )
    db.add(new_log)
    db.commit()

    # Starts run_retraining as a FastAPI BackgroundTask
    background_tasks.add_task(run_retraining, log_id, get_settings().database_url)
    
    return {"message": "Retraining triggered successfully", "log_id": log_id}
