from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.company import Company
from app.models.company_head import CompanyHead
from app.models.department import Department
from app.models.department_manager import DepartmentManager
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.system_admin_profile import SystemAdminProfile
from app.models.user import User

# NOTE: Development/demo accounts only. All default passwords must be changed in production.
DEV_SUPER_ADMINS = [
    {"full_name": "Super Admin 1", "email": "rafi.almahmud.007@gmail.com", "password": "Rafi0008.@"},
    {"full_name": "Super Admin 2", "email": "wardat@gmail.com", "password": "12345678"},
    {"full_name": "Super Admin 3", "email": "yaad@gmail.com", "password": "12345678"},
]

# Canonical email -> legacy aliases to auto-migrate on startup.
LEGACY_EMAIL_ALIASES = {
    "rafi.almahmud.007@gmail.com": ["rafi.almahmud.007", "rafi.almahmud.007@gmail"],
}


def _get_or_create_user(
    db: Session,
    *,
    full_name: str,
    email: str,
    password: str,
    role: UserRole,
    is_active: bool = True,
    reset_password: bool = False,
    legacy_emails: list[str] | None = None,
) -> User:
    normalized_email = email.strip().lower()
    candidate_emails = [normalized_email]
    if legacy_emails:
        for legacy_email in legacy_emails:
            normalized_legacy = legacy_email.strip().lower()
            if normalized_legacy and normalized_legacy not in candidate_emails:
                candidate_emails.append(normalized_legacy)

    users = db.scalars(select(User).where(User.email.in_(candidate_emails))).all()
    user = next((candidate for candidate in users if candidate.email == normalized_email), None)
    if not user and users:
        user = users[0]

    if user:
        if user.email != normalized_email:
            user.email = normalized_email
        if user.role != role:
            user.role = role
        user.full_name = full_name
        user.is_active = is_active
        if reset_password or not user.password_hash:
            user.password_hash = get_password_hash(password)
        return user

    user = User(
        full_name=full_name,
        email=normalized_email,
        password_hash=get_password_hash(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def seed_initial_data(db: Session) -> None:
    super_admin_users: list[User] = []
    for account in DEV_SUPER_ADMINS:
        super_admin_users.append(
            _get_or_create_user(
                db,
                full_name=account["full_name"],
                email=account["email"],
                password=account["password"],
                role=UserRole.SUPER_ADMIN,
                reset_password=True,
                legacy_emails=LEGACY_EMAIL_ALIASES.get(account["email"], []),
            )
        )

    creator_user = super_admin_users[0]

    sample_system_admin = _get_or_create_user(
        db,
        full_name="System Admin Sample",
        email="system.admin@mindwell.demo",
        password="SystemAdmin123!",
        role=UserRole.SYSTEM_ADMIN,
        reset_password=True,
    )
    system_admin_profile = db.scalar(select(SystemAdminProfile).where(SystemAdminProfile.user_id == sample_system_admin.id))
    if not system_admin_profile:
        db.add(SystemAdminProfile(user_id=sample_system_admin.id, created_by_user_id=creator_user.id))

    company = db.scalar(select(Company).where(Company.code == "MW-DEMO"))
    if not company:
        company = Company(
            name="MindWell Demo Company",
            code="MW-DEMO",
            description="Sample seeded company for development and demo use.",
            created_by_user_id=creator_user.id,
            is_active=True,
        )
        db.add(company)
        db.flush()

    company_head_by_company = db.scalar(select(CompanyHead).where(CompanyHead.company_id == company.id))
    if not company_head_by_company:
        company_head_user = _get_or_create_user(
            db,
            full_name="Company Head Sample",
            email="company.head@mindwell.demo",
            password="CompanyHead123!",
            role=UserRole.COMPANY_HEAD,
            reset_password=True,
        )
        company_head_by_user = db.scalar(select(CompanyHead).where(CompanyHead.user_id == company_head_user.id))
        if company_head_by_user:
            company_head_by_user.company_id = company.id
        else:
            db.add(CompanyHead(user_id=company_head_user.id, company_id=company.id))

    hr_department = db.scalar(
        select(Department).where(Department.company_id == company.id, Department.code == "HR")
    )
    if not hr_department:
        hr_department = Department(
            company_id=company.id,
            name="Human Resources",
            code="HR",
            description="Employee support and people operations.",
            is_active=True,
        )
        db.add(hr_department)
        db.flush()

    eng_department = db.scalar(
        select(Department).where(Department.company_id == company.id, Department.code == "ENG")
    )
    if not eng_department:
        eng_department = Department(
            company_id=company.id,
            name="Engineering",
            code="ENG",
            description="Product and platform engineering teams.",
            is_active=True,
        )
        db.add(eng_department)
        db.flush()

    manager_records = [
        {
            "full_name": "HR Manager Sample",
            "email": "manager.hr@mindwell.demo",
            "password": "ManagerHR123!",
            "department_id": hr_department.id,
        },
        {
            "full_name": "Engineering Manager Sample",
            "email": "manager.eng@mindwell.demo",
            "password": "ManagerEng123!",
            "department_id": eng_department.id,
        },
    ]

    for manager_data in manager_records:
        manager_profile_by_department = db.scalar(
            select(DepartmentManager).where(DepartmentManager.department_id == manager_data["department_id"])
        )
        if manager_profile_by_department:
            manager_profile_by_department.company_id = company.id
            continue

        manager_user = _get_or_create_user(
            db,
            full_name=manager_data["full_name"],
            email=manager_data["email"],
            password=manager_data["password"],
            role=UserRole.DEPARTMENT_MANAGER,
            reset_password=True,
        )
        manager_profile_by_user = db.scalar(select(DepartmentManager).where(DepartmentManager.user_id == manager_user.id))
        if manager_profile_by_user:
            manager_profile_by_user.company_id = company.id
            manager_profile_by_user.department_id = manager_data["department_id"]
        else:
            db.add(
                DepartmentManager(
                    user_id=manager_user.id,
                    company_id=company.id,
                    department_id=manager_data["department_id"],
                )
            )

    employee_records = [
        {
            "full_name": "Employee One",
            "email": "employee.one@mindwell.demo",
            "password": "Employee123!",
            "department_id": hr_department.id,
            "employee_code": "EMP001",
            "job_title": "HR Specialist",
        },
        {
            "full_name": "Employee Two",
            "email": "employee.two@mindwell.demo",
            "password": "Employee123!",
            "department_id": hr_department.id,
            "employee_code": "EMP002",
            "job_title": "Recruiter",
        },
        {
            "full_name": "Employee Three",
            "email": "employee.three@mindwell.demo",
            "password": "Employee123!",
            "department_id": eng_department.id,
            "employee_code": "EMP003",
            "job_title": "Software Engineer",
        },
        {
            "full_name": "Employee Four",
            "email": "employee.four@mindwell.demo",
            "password": "Employee123!",
            "department_id": eng_department.id,
            "employee_code": "EMP004",
            "job_title": "QA Engineer",
        },
    ]

    for employee_data in employee_records:
        employee_profile_by_code = db.scalar(
            select(Employee).where(Employee.employee_code == employee_data["employee_code"])
        )
        if employee_profile_by_code:
            employee_profile_by_code.company_id = company.id
            employee_profile_by_code.department_id = employee_data["department_id"]
            employee_profile_by_code.job_title = employee_data["job_title"]
            continue

        employee_user = _get_or_create_user(
            db,
            full_name=employee_data["full_name"],
            email=employee_data["email"],
            password=employee_data["password"],
            role=UserRole.EMPLOYEE,
            reset_password=True,
        )
        employee_profile_by_user = db.scalar(select(Employee).where(Employee.user_id == employee_user.id))
        if employee_profile_by_user:
            employee_profile_by_user.company_id = company.id
            employee_profile_by_user.department_id = employee_data["department_id"]
            employee_profile_by_user.employee_code = employee_data["employee_code"]
            employee_profile_by_user.job_title = employee_data["job_title"]
        else:
            db.add(
                Employee(
                    user_id=employee_user.id,
                    company_id=company.id,
                    department_id=employee_data["department_id"],
                    employee_code=employee_data["employee_code"],
                    job_title=employee_data["job_title"],
                )
            )

    db.commit()
