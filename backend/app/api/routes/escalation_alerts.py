from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.escalation_alert import EscalationAlert
from app.models.user import User
from app.schemas.escalation_alert import (
    EscalationAlertHistoryResponse,
    EscalationAlertListResponse,
    EscalationAlertRead,
)
from app.services.hierarchy import get_department_manager_profile_for_user_or_403

router = APIRouter(prefix="/escalation-alerts", tags=["Escalation Alerts"])


def _serialize(alert: EscalationAlert) -> EscalationAlertRead:
    return EscalationAlertRead(
        id=alert.id,
        department_id=alert.department_id,
        company_id=alert.company_id,
        condition_type=alert.condition_type,
        details=alert.details,
        is_acknowledged=alert.is_acknowledged,
        acknowledged_at=alert.acknowledged_at,
        acknowledged_by_name=alert.acknowledged_by.full_name if alert.acknowledged_by else None,
        email_sent=alert.email_sent,
        created_at=alert.created_at,
    )


@router.get("", response_model=EscalationAlertListResponse)
def list_unacknowledged_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> EscalationAlertListResponse:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    alerts = (
        db.query(EscalationAlert)
        .filter(
            EscalationAlert.department_id == manager.department_id,
            EscalationAlert.is_acknowledged.is_(False),
        )
        .order_by(EscalationAlert.created_at.desc())
        .all()
    )
    return EscalationAlertListResponse(
        alerts=[_serialize(a) for a in alerts],
        unacknowledged_count=len(alerts),
    )


@router.get("/history", response_model=EscalationAlertHistoryResponse)
def list_alert_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> EscalationAlertHistoryResponse:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    query = (
        db.query(EscalationAlert)
        .filter(EscalationAlert.department_id == manager.department_id)
        .order_by(EscalationAlert.created_at.desc())
    )
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return EscalationAlertHistoryResponse(
        items=[_serialize(a) for a in items],
        total=total,
    )


@router.post("/{alert_id}/acknowledge", response_model=EscalationAlertRead)
def acknowledge_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.DEPARTMENT_MANAGER)),
) -> EscalationAlertRead:
    manager = get_department_manager_profile_for_user_or_403(db, current_user)
    alert = db.get(EscalationAlert, alert_id)
    if not alert or alert.department_id != manager.department_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    # Idempotent: already-acknowledged returns current state
    if not alert.is_acknowledged:
        alert.is_acknowledged = True
        alert.acknowledged_at = datetime.now(timezone.utc)
        alert.acknowledged_by_user_id = current_user.id
        db.commit()
        db.refresh(alert)

    return _serialize(alert)
