from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.company_head import CompanyHead
from app.models.department import Department
from app.models.department_manager import DepartmentManager
from app.models.enums import InvitationStatus, UserRole
from app.models.invitation import Invitation
from app.models.user import User


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


def get_company_head_profile_for_user_or_403(db: Session, user: User) -> CompanyHead:
    profile = db.scalar(select(CompanyHead).where(CompanyHead.user_id == user.id))

    if not profile:
        latest_used_invitation = db.scalar(
            select(Invitation)
            .where(
                Invitation.user_id == user.id,
                Invitation.role == UserRole.COMPANY_HEAD,
                Invitation.status == InvitationStatus.USED,
                Invitation.company_id.is_not(None),
            )
            .order_by(Invitation.created_at.desc())
        )
        if latest_used_invitation and latest_used_invitation.company_id:
            existing_company_mapping = db.scalar(
                select(CompanyHead).where(CompanyHead.company_id == latest_used_invitation.company_id)
            )
            if existing_company_mapping and existing_company_mapping.user_id != user.id:
                existing_user = db.get(User, existing_company_mapping.user_id)
                # Replace seeded/demo placeholder mappings with the accepted invite account.
                if existing_user and existing_user.email.endswith("@mindwell.demo"):
                    db.delete(existing_company_mapping)
                    db.flush()
                    existing_company_mapping = None

            if not existing_company_mapping:
                profile = CompanyHead(user_id=user.id, company_id=latest_used_invitation.company_id)
                db.add(profile)
                db.flush()

    if not profile:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company head profile is not configured")
    return profile


def get_department_manager_profile_for_user_or_403(db: Session, user: User) -> DepartmentManager:
    profile = db.scalar(select(DepartmentManager).where(DepartmentManager.user_id == user.id))

    if not profile:
        latest_used_invitation = db.scalar(
            select(Invitation)
            .where(
                Invitation.user_id == user.id,
                Invitation.role == UserRole.DEPARTMENT_MANAGER,
                Invitation.status == InvitationStatus.USED,
                Invitation.company_id.is_not(None),
                Invitation.department_id.is_not(None),
            )
            .order_by(Invitation.created_at.desc())
        )
        if latest_used_invitation and latest_used_invitation.company_id and latest_used_invitation.department_id:
            existing_department_mapping = db.scalar(
                select(DepartmentManager).where(DepartmentManager.department_id == latest_used_invitation.department_id)
            )
            if existing_department_mapping and existing_department_mapping.user_id != user.id:
                existing_user = db.get(User, existing_department_mapping.user_id)
                if existing_user and existing_user.email.endswith("@mindwell.demo"):
                    db.delete(existing_department_mapping)
                    db.flush()
                    existing_department_mapping = None

            if not existing_department_mapping:
                profile = DepartmentManager(
                    user_id=user.id,
                    company_id=latest_used_invitation.company_id,
                    department_id=latest_used_invitation.department_id,
                )
                db.add(profile)
                db.flush()

    if not profile:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department manager profile is not configured")
    return profile


def ensure_company_access_for_company_head(profile: CompanyHead, company_id: int) -> None:
    if profile.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied outside your company")


def ensure_company_access_for_department_manager(profile: DepartmentManager, company_id: int) -> None:
    if profile.company_id != company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied outside your department scope")


def ensure_department_access_for_department_manager(profile: DepartmentManager, department_id: int) -> None:
    if profile.department_id != department_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied outside your assigned department",
        )
