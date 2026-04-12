import { apiClient } from './client';
import type {
  AuthResponse,
  Company,
  CompanyHeadProfile,
  CompanyOption,
  Department,
  DepartmentManagerProfile,
  DepartmentOption,
  EmployeeProfile,
  PaginatedResponse,
  SuperAdminSummary,
  SystemAdminProfile,
  SystemAdminSummary,
  User,
} from '../types/domain';

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  companyId?: number;
  departmentId?: number;
}

const toListParams = (query: ListQuery = {}): Record<string, string | number> => {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    page_size: query.pageSize ?? 10,
  };
  if (query.search) params.search = query.search;
  if (query.companyId) params.company_id = query.companyId;
  if (query.departmentId) params.department_id = query.departmentId;
  return params;
};

export interface LoginPayload {
  email: string;
  password: string;
}

export interface InvitationValidatePayload {
  email: string;
  invitation_code: string;
}

export interface InvitationValidateResponse {
  valid: boolean;
  message: string;
  role: string | null;
  company_name: string | null;
  department_name: string | null;
  full_name: string | null;
  email: string | null;
  expires_at: string | null;
  status: string | null;
}

export interface InvitationSignupPayload {
  email: string;
  invitation_code: string;
  full_name: string;
  password: string;
  confirm_password: string;
}

export interface InvitationSignupResponse {
  message: string;
  role: string;
}

export interface InvitationActionResponse {
  message: string;
  invitation: {
    id: number;
    status: string;
    expires_at: string | null;
    sent_at: string | null;
    used_at: string | null;
    created_at: string;
    updated_at: string;
  };
}

export const authApi = {
  signIn: async (payload: LoginPayload): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', payload);
    return response.data;
  },
  me: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },
};

export const invitationsApi = {
  validate: async (payload: InvitationValidatePayload): Promise<InvitationValidateResponse> => {
    const response = await apiClient.post<InvitationValidateResponse>('/invitations/validate', payload);
    return response.data;
  },
  signup: async (payload: InvitationSignupPayload): Promise<InvitationSignupResponse> => {
    const response = await apiClient.post<InvitationSignupResponse>('/invitations/signup', payload);
    return response.data;
  },
  resend: async (invitationId: number): Promise<InvitationActionResponse> => {
    const response = await apiClient.post<InvitationActionResponse>(`/invitations/${invitationId}/resend`);
    return response.data;
  },
  cancel: async (invitationId: number): Promise<InvitationActionResponse> => {
    const response = await apiClient.post<InvitationActionResponse>(`/invitations/${invitationId}/cancel`);
    return response.data;
  },
};

export const dashboardApi = {
  superAdminSummary: async (): Promise<SuperAdminSummary> => {
    const response = await apiClient.get<SuperAdminSummary>('/dashboard/super-admin/summary');
    return response.data;
  },
  systemAdminSummary: async (): Promise<SystemAdminSummary> => {
    const response = await apiClient.get<SystemAdminSummary>('/dashboard/system-admin/summary');
    return response.data;
  },
};

export const optionsApi = {
  companies: async (): Promise<CompanyOption[]> => {
    const response = await apiClient.get<CompanyOption[]>('/companies/options');
    return response.data;
  },
  departments: async (companyId?: number): Promise<DepartmentOption[]> => {
    const response = await apiClient.get<DepartmentOption[]>('/departments/options', {
      params: companyId ? { company_id: companyId } : undefined,
    });
    return response.data;
  },
};

export interface SystemAdminCreatePayload {
  full_name: string;
  email: string;
  password: string;
  is_active: boolean;
}

export interface SystemAdminUpdatePayload {
  full_name?: string;
  email?: string;
  is_active?: boolean;
}

export const systemAdminApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<SystemAdminProfile>> => {
    const response = await apiClient.get<PaginatedResponse<SystemAdminProfile>>('/system-admins', {
      params: toListParams(query),
    });
    return response.data;
  },
  create: async (payload: SystemAdminCreatePayload): Promise<SystemAdminProfile> => {
    const response = await apiClient.post<SystemAdminProfile>('/system-admins', payload);
    return response.data;
  },
  update: async (id: number, payload: SystemAdminUpdatePayload): Promise<SystemAdminProfile> => {
    const response = await apiClient.put<SystemAdminProfile>(`/system-admins/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/system-admins/${id}`);
  },
};

export interface CompanyPayload {
  name: string;
  code: string;
  description?: string | null;
  is_active: boolean;
}

export const companiesApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<Company>> => {
    const response = await apiClient.get<PaginatedResponse<Company>>('/companies', { params: toListParams(query) });
    return response.data;
  },
  create: async (payload: CompanyPayload): Promise<Company> => {
    const response = await apiClient.post<Company>('/companies', payload);
    return response.data;
  },
  update: async (id: number, payload: Partial<CompanyPayload>): Promise<Company> => {
    const response = await apiClient.put<Company>(`/companies/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/companies/${id}`);
  },
};

export interface CompanyHeadPayload {
  full_name: string;
  email: string;
  company_id: number;
}

export interface CompanyHeadUpdatePayload {
  full_name?: string;
  email?: string;
  company_id?: number;
  is_active?: boolean;
}

export const companyHeadsApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<CompanyHeadProfile>> => {
    const response = await apiClient.get<PaginatedResponse<CompanyHeadProfile>>('/company-heads', {
      params: toListParams(query),
    });
    return response.data;
  },
  create: async (payload: CompanyHeadPayload): Promise<CompanyHeadProfile> => {
    const response = await apiClient.post<CompanyHeadProfile>('/company-heads', payload);
    return response.data;
  },
  update: async (id: number, payload: CompanyHeadUpdatePayload): Promise<CompanyHeadProfile> => {
    const response = await apiClient.put<CompanyHeadProfile>(`/company-heads/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/company-heads/${id}`);
  },
};

export interface DepartmentPayload {
  company_id: number;
  name: string;
  code: string;
  description?: string | null;
  is_active: boolean;
}

export const departmentsApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<Department>> => {
    const response = await apiClient.get<PaginatedResponse<Department>>('/departments', { params: toListParams(query) });
    return response.data;
  },
  create: async (payload: DepartmentPayload): Promise<Department> => {
    const response = await apiClient.post<Department>('/departments', payload);
    return response.data;
  },
  update: async (id: number, payload: Partial<DepartmentPayload>): Promise<Department> => {
    const response = await apiClient.put<Department>(`/departments/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/departments/${id}`);
  },
};

export interface DepartmentManagerPayload {
  full_name: string;
  email: string;
  company_id: number;
  department_id: number;
}

export interface DepartmentManagerUpdatePayload {
  full_name?: string;
  email?: string;
  company_id?: number;
  department_id?: number;
  is_active?: boolean;
}

export const departmentManagersApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<DepartmentManagerProfile>> => {
    const response = await apiClient.get<PaginatedResponse<DepartmentManagerProfile>>('/department-managers', {
      params: toListParams(query),
    });
    return response.data;
  },
  create: async (payload: DepartmentManagerPayload): Promise<DepartmentManagerProfile> => {
    const response = await apiClient.post<DepartmentManagerProfile>('/department-managers', payload);
    return response.data;
  },
  update: async (id: number, payload: DepartmentManagerUpdatePayload): Promise<DepartmentManagerProfile> => {
    const response = await apiClient.put<DepartmentManagerProfile>(`/department-managers/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/department-managers/${id}`);
  },
};

export interface EmployeePayload {
  full_name: string;
  email: string;
  company_id: number;
  department_id: number;
  employee_code?: string | null;
  job_title?: string | null;
}

export interface EmployeeUpdatePayload {
  full_name?: string;
  email?: string;
  company_id?: number;
  department_id?: number;
  employee_code?: string | null;
  job_title?: string | null;
  is_active?: boolean;
}

export const superAdminApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<User>> => {
    const response = await apiClient.get<PaginatedResponse<User>>('/super-admins', {
      params: toListParams(query),
    });
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/super-admins/${id}`);
  },
};

export const employeesApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<EmployeeProfile>> => {
    const response = await apiClient.get<PaginatedResponse<EmployeeProfile>>('/employees', { params: toListParams(query) });
    return response.data;
  },
  create: async (payload: EmployeePayload): Promise<EmployeeProfile> => {
    const response = await apiClient.post<EmployeeProfile>('/employees', payload);
    return response.data;
  },
  update: async (id: number, payload: EmployeeUpdatePayload): Promise<EmployeeProfile> => {
    const response = await apiClient.put<EmployeeProfile>(`/employees/${id}`, payload);
    return response.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/employees/${id}`);
  },
};
