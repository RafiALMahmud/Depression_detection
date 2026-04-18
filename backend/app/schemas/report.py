from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class FlaggedEmployeeEntry(BaseModel):
    anonymized_id: str
    threshold_tier: str
    composite_score: float | None
    facial_score: float | None
    questionnaire_score: float | None
    sessions_count: int


class DepartmentReportSummary(BaseModel):
    total_employees: int
    flagged_count: int
    compliant_count: int
    average_composite_score: float | None


class ReportPreview(BaseModel):
    department_id: int
    company_id: int
    department_summary: DepartmentReportSummary
    flagged_employees: list[FlaggedEmployeeEntry]
    next_version: int


class ReportSubmitRequest(BaseModel):
    assessment: str = Field(min_length=1, max_length=5000)
    behavioral_patterns: str = Field(default="", max_length=5000)
    recommended_interventions: str = Field(default="", max_length=5000)


class ReportRead(BaseModel):
    id: int
    department_id: int
    company_id: int
    manager_name: str | None
    version: int
    assessment: str | None
    behavioral_patterns: str | None
    recommended_interventions: str | None
    flagged_employee_count: int
    department_summary: dict[str, Any] | None
    flagged_employees_data: list[Any] | None
    status: str
    submitted_at: datetime
    created_at: datetime


class ReportListResponse(BaseModel):
    items: list[ReportRead]
    total: int
