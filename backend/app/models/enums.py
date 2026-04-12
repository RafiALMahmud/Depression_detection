import enum


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    SYSTEM_ADMIN = "system_admin"
    COMPANY_HEAD = "company_head"
    DEPARTMENT_MANAGER = "department_manager"
    EMPLOYEE = "employee"


class InvitationStatus(str, enum.Enum):
    PENDING = "pending"
    USED = "used"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
