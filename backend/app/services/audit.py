from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import AuditLog


def write_audit_log(
    db: Session,
    action: str,
    user_id: Optional[int] = None,
    case_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    details: Optional[Any] = None,
    timestamp: Optional[datetime] = None,
) -> None:
    log_entry = AuditLog(
        user_id=user_id,
        action=action,
        case_id=case_id,
        ip_address=ip_address,
        details=details,
    )
    if timestamp is not None:
        log_entry.timestamp = timestamp
    db.add(log_entry)
