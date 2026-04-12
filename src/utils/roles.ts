import type { UserRole } from '../types/domain';

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  system_admin: 'System Admin',
  company_head: 'Company Head',
  department_manager: 'Department Manager',
  employee: 'Employee',
};

export const getDashboardPathByRole = (role: UserRole): string => {
  switch (role) {
    case 'super_admin':
      return '/dashboard/super-admin';
    case 'system_admin':
      return '/dashboard/system-admin';
    case 'company_head':
      return '/dashboard/company-head';
    case 'department_manager':
      return '/dashboard/department-manager';
    case 'employee':
      return '/dashboard/employee';
    default:
      return '/sign-in';
  }
};

