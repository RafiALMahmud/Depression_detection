from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class EscalationAlertRead(BaseModel):
    id: int
    department_id: int
    company_id: int
    condition_type: str
    details: dict[str, Any] | None
    is_acknowledged: bool
    acknowledged_at: datetime | None
    acknowledged_by_name: str | None
    email_sent: bool
    created_at: datetime


class EscalationAlertListResponse(BaseModel):
    alerts: list[EscalationAlertRead]
    unacknowledged_count: int


class EscalationAlertHistoryResponse(BaseModel):
    items: list[EscalationAlertRead]
    total: int
