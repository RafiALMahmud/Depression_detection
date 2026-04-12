from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.department import Department


def get_company_or_404(db: Session, company_id: int) -> Company:
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


def get_department_or_404(db: Session, department_id: int) -> Department:
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    return department


def validate_department_belongs_to_company(department: Department, company_id: int) -> None:
    if department.company_id != company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Department does not belong to the selected company",
        )

