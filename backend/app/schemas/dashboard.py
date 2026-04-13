from datetime import datetime

from pydantic import BaseModel

from app.models.enums import InvitationStatus, UserRole


class SuperAdminSummary(BaseModel):
    total_system_admins: int
    total_companies: int
    total_company_heads: int
    total_departments: int
    total_department_managers: int
    total_employees: int


class SystemAdminSummary(BaseModel):
    total_companies: int
    total_company_heads: int
    total_departments: int
    total_department_managers: int
    total_employees: int


class SummaryInvitationPreview(BaseModel):
    id: int
    full_name: str
    email: str
    role: UserRole
    status: InvitationStatus
    sent_at: datetime | None
    expires_at: datetime | None
    created_at: datetime


class SummaryUserPreview(BaseModel):
    id: int
    full_name: str
    email: str
    created_at: datetime


class CompanyDepartmentBreakdown(BaseModel):
    department_id: int
    department_name: str
    department_code: str
    department_manager_count: int
    employee_count: int


class CompanyHeadSummary(BaseModel):
    company_id: int
    company_name: str
    total_departments: int
    total_department_managers: int
    total_employees: int
    active_invitations_count: int
    completed_onboardings_count: int
    department_breakdown: list[CompanyDepartmentBreakdown]
    recent_invitations: list[SummaryInvitationPreview]
    recent_employees: list[SummaryUserPreview]


class DepartmentManagerSummary(BaseModel):
    company_id: int
    company_name: str
    department_id: int
    department_name: str
    total_employees: int
    active_invitations_count: int
    completed_onboardings_count: int
    scanned_employees_count_placeholder: int
    average_wellness_score_placeholder: float | None
    recent_invitations: list[SummaryInvitationPreview]
    recent_employees: list[SummaryUserPreview]
