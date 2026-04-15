from fastapi import APIRouter

from app.api.routes import (
    auth,
    companies,
    company_heads,
    dashboard,
    department_managers,
    departments,
    employees,
    invitations,
    questionnaire,
    super_admins,
    system_admins,
    vision,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(super_admins.router)
api_router.include_router(system_admins.router)
api_router.include_router(companies.router)
api_router.include_router(company_heads.router)
api_router.include_router(departments.router)
api_router.include_router(department_managers.router)
api_router.include_router(employees.router)
api_router.include_router(invitations.router)
api_router.include_router(vision.router)
api_router.include_router(questionnaire.router)
