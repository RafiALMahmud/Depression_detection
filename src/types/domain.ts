export type UserRole =
  | 'super_admin'
  | 'system_admin'
  | 'company_head'
  | 'department_manager'
  | 'employee';

export type InvitationStatus = 'pending' | 'used' | 'expired' | 'cancelled';

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface SystemAdminProfile {
  id: number;
  user: User;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface InvitationSnapshot {
  id: number;
  status: InvitationStatus;
  expires_at: string | null;
  sent_at: string | null;
  used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: number;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyOption {
  id: number;
  name: string;
  code: string;
}

export interface CompanyHeadProfile {
  id: number;
  user: User;
  company_id: number;
  invitation: InvitationSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: number;
  company_id: number;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DepartmentOption {
  id: number;
  company_id: number;
  name: string;
  code: string;
}

export interface DepartmentManagerProfile {
  id: number;
  user: User;
  company_id: number;
  department_id: number;
  invitation: InvitationSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeProfile {
  id: number;
  user: User;
  company_id: number;
  department_id: number;
  employee_code: string | null;
  job_title: string | null;
  invitation: InvitationSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface SuperAdminSummary {
  total_system_admins: number;
  total_companies: number;
  total_company_heads: number;
  total_departments: number;
  total_department_managers: number;
  total_employees: number;
}

export interface SystemAdminSummary {
  total_companies: number;
  total_company_heads: number;
  total_departments: number;
  total_department_managers: number;
  total_employees: number;
}

export interface SummaryInvitationPreview {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  sent_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface SummaryUserPreview {
  id: number;
  full_name: string;
  email: string;
  created_at: string;
}

export interface CompanyHeadSummary {
  company_id: number;
  company_name: string;
  total_departments: number;
  total_department_managers: number;
  total_employees: number;
  active_invitations_count: number;
  completed_onboardings_count: number;
  department_breakdown: CompanyDepartmentBreakdown[];
  recent_invitations: SummaryInvitationPreview[];
  recent_employees: SummaryUserPreview[];
}

export interface CompanyDepartmentBreakdown {
  department_id: number;
  department_name: string;
  department_code: string;
  department_manager_count: number;
  employee_count: number;
}

export interface DepartmentManagerSummary {
  company_id: number;
  company_name: string;
  department_id: number;
  department_name: string;
  total_employees: number;
  active_invitations_count: number;
  completed_onboardings_count: number;
  scanned_employees_count_placeholder: number;
  average_wellness_score_placeholder: number | null;
  recent_invitations: SummaryInvitationPreview[];
  recent_employees: SummaryUserPreview[];
}

export interface InvitationListItem {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  company_id: number | null;
  company_name: string | null;
  department_id: number | null;
  department_name: string | null;
  status: InvitationStatus;
  sent_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
