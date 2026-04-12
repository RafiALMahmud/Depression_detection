from pydantic import BaseModel


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

