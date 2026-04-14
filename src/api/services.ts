import { apiClient } from './client';
import type {
  AuthResponse,
  Company,
  CompanyDepartmentBreakdown,
  CompanyHeadSummary,
  CompanyHeadProfile,
  CompanyOption,
  Department,
  DepartmentManagerSummary,
  DepartmentManagerProfile,
  DepartmentOption,
  EmployeeProfile,
  InvitationListItem,
  PaginatedResponse,
  PaginationMeta,
  SummaryInvitationPreview,
  SummaryUserPreview,
  SuperAdminSummary,
  SystemAdminProfile,
  SystemAdminSummary,
  UserRole,
  InvitationStatus,
  User,
  MoodScore,
  FrameMoodPrediction,
  VisionModelStatus,
  VisionPredictionResult,
} from '../types/domain';

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  companyId?: number;
  departmentId?: number;
}

export interface InvitationListQuery extends ListQuery {
  role?: UserRole;
  status?: InvitationStatus;
}

const ensureArray = <T,>(value: unknown): T[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => item !== null && item !== undefined);
};

const normalizePaginationMeta = (meta: Partial<PaginationMeta> | null | undefined): PaginationMeta => {
  const page = Number(meta?.page ?? 1);
  const pageSize = Number(meta?.page_size ?? 10);
  const total = Number(meta?.total ?? 0);
  const totalPages = Number(meta?.total_pages ?? 1);

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    total_pages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
  };
};

const normalizePaginatedResponse = <T,>(payload: Partial<PaginatedResponse<T>> | null | undefined): PaginatedResponse<T> => ({
  items: ensureArray<T>(payload?.items),
  meta: normalizePaginationMeta(payload?.meta),
});

const normalizeCompanyHeadSummary = (
  payload: CompanyHeadSummary | null | undefined,
): CompanyHeadSummary => ({
  company_id: payload?.company_id ?? 0,
  company_name: payload?.company_name ?? 'MindWell Company',
  total_departments: payload?.total_departments ?? 0,
  total_department_managers: payload?.total_department_managers ?? 0,
  total_employees: payload?.total_employees ?? 0,
  active_invitations_count: payload?.active_invitations_count ?? 0,
  completed_onboardings_count: payload?.completed_onboardings_count ?? 0,
  department_breakdown: ensureArray<CompanyDepartmentBreakdown>(payload?.department_breakdown),
  recent_invitations: ensureArray<SummaryInvitationPreview>(payload?.recent_invitations),
  recent_employees: ensureArray<SummaryUserPreview>(payload?.recent_employees),
});

const normalizeDepartmentManagerSummary = (
  payload: DepartmentManagerSummary | null | undefined,
): DepartmentManagerSummary => ({
  company_id: payload?.company_id ?? 0,
  company_name: payload?.company_name ?? 'MindWell Company',
  department_id: payload?.department_id ?? 0,
  department_name: payload?.department_name ?? 'Assigned Department',
  total_employees: payload?.total_employees ?? 0,
  active_invitations_count: payload?.active_invitations_count ?? 0,
  completed_onboardings_count: payload?.completed_onboardings_count ?? 0,
  scanned_employees_count_placeholder: payload?.scanned_employees_count_placeholder ?? 0,
  average_wellness_score_placeholder: payload?.average_wellness_score_placeholder ?? null,
  recent_invitations: ensureArray<SummaryInvitationPreview>(payload?.recent_invitations),
  recent_employees: ensureArray<SummaryUserPreview>(payload?.recent_employees),
});

const expectNonEmptyString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`MindWell received an invalid ${fieldName} from the vision service.`);
  }
  return value;
};

const expectFiniteNumber = (value: unknown, fieldName: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`MindWell received an invalid ${fieldName} from the vision service.`);
  }
  return parsed;
};

const expectBoolean = (value: unknown, fieldName: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`MindWell received an invalid ${fieldName} from the vision service.`);
  }
  return value;
};

const expectStringArray = (value: unknown, fieldName: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`MindWell received an invalid ${fieldName} from the vision service.`);
  }
  return value;
};

const normalizeMoodScore = (payload: unknown): MoodScore => {
  const candidate = payload as Partial<MoodScore> | null | undefined;
  const confidence = expectFiniteNumber(candidate?.confidence, 'vision score confidence');
  if (confidence < 0 || confidence > 1) {
    throw new Error('MindWell received an out-of-range confidence score from the vision service.');
  }
  return {
    label: expectNonEmptyString(candidate?.label, 'vision score label'),
    confidence,
  };
};

const normalizeFrameMoodPrediction = (payload: unknown): FrameMoodPrediction => {
  const candidate = payload as Partial<FrameMoodPrediction> | null | undefined;
  const dominantConfidence = expectFiniteNumber(candidate?.dominant_confidence, 'frame dominant confidence');
  if (dominantConfidence < 0 || dominantConfidence > 1) {
    throw new Error('MindWell received an out-of-range frame confidence from the vision service.');
  }
  const scores = ensureArray<unknown>(candidate?.scores).map(normalizeMoodScore);
  if (!scores.length) {
    throw new Error('MindWell received a frame prediction without any facial score entries.');
  }
  return {
    frame_index: expectFiniteNumber(candidate?.frame_index, 'frame index'),
    dominant_label: expectNonEmptyString(candidate?.dominant_label, 'frame dominant label'),
    dominant_confidence: dominantConfidence,
    scores,
  };
};

const normalizeVisionPrediction = (payload: unknown): VisionPredictionResult => {
  const candidate = payload as Partial<VisionPredictionResult> | null | undefined;
  const dominantConfidence = expectFiniteNumber(candidate?.dominant_confidence, 'dominant confidence');
  if (dominantConfidence < 0 || dominantConfidence > 1) {
    throw new Error('MindWell received an out-of-range dominant confidence from the vision service.');
  }
  const averagedScores = ensureArray<unknown>(candidate?.averaged_scores).map(normalizeMoodScore);
  const frames = ensureArray<unknown>(candidate?.frames).map(normalizeFrameMoodPrediction);
  if (!averagedScores.length || !frames.length) {
    throw new Error('MindWell received an incomplete facial scan response from the vision service.');
  }
  return {
    model_name: expectNonEmptyString(candidate?.model_name, 'model name'),
    frame_count: expectFiniteNumber(candidate?.frame_count, 'frame count'),
    dominant_label: expectNonEmptyString(candidate?.dominant_label, 'dominant label'),
    dominant_confidence: dominantConfidence,
    averaged_scores: averagedScores,
    frames,
  };
};

const normalizeVisionModelStatus = (payload: unknown): VisionModelStatus => {
  const candidate = payload as Partial<VisionModelStatus> | null | undefined;
  return {
    ready: expectBoolean(candidate?.ready, 'vision readiness flag'),
    message: expectNonEmptyString(candidate?.message, 'vision readiness message'),
    architecture: expectNonEmptyString(candidate?.architecture, 'vision architecture'),
    weights_path: expectNonEmptyString(candidate?.weights_path, 'vision weights path'),
    weights_found: expectBoolean(candidate?.weights_found, 'vision weights availability'),
    input_size: expectFiniteNumber(candidate?.input_size, 'vision input size'),
    max_frames_per_request: expectFiniteNumber(candidate?.max_frames_per_request, 'vision frame limit'),
    class_labels: expectStringArray(candidate?.class_labels, 'vision class labels'),
    load_error: candidate?.load_error == null ? null : expectNonEmptyString(candidate.load_error, 'vision load error'),
  };
};

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

const toInvitationListParams = (query: InvitationListQuery = {}): Record<string, string | number> => {
  const params = toListParams(query);
  if (query.role) params.role = query.role;
  if (query.status) params.status = query.status;
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
    return {
      ...response.data,
      user: response.data.user,
    };
  },
  me: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },
};

export const visionApi = {
  status: async (): Promise<VisionModelStatus> => {
    const response = await apiClient.get<VisionModelStatus>('/vision/status');
    return normalizeVisionModelStatus(response.data);
  },
  predict: async (frames: Blob[], topK = 3): Promise<VisionPredictionResult> => {
    const formData = new FormData();
    frames.forEach((frame, index) => {
      formData.append('frames', frame, `scan-frame-${index + 1}.jpg`);
    });
    const response = await apiClient.post<VisionPredictionResult>('/vision/predict', formData, {
      params: { top_k: topK },
    });
    return normalizeVisionPrediction(response.data);
  },
};

export const invitationsApi = {
  list: async (query: InvitationListQuery): Promise<PaginatedResponse<InvitationListItem>> => {
    const response = await apiClient.get<PaginatedResponse<InvitationListItem>>('/invitations', {
      params: toInvitationListParams(query),
    });
    return normalizePaginatedResponse<InvitationListItem>(response.data);
  },
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
  companyHeadSummary: async (): Promise<CompanyHeadSummary> => {
    const response = await apiClient.get<CompanyHeadSummary>('/dashboard/company-head/summary');
    return normalizeCompanyHeadSummary(response.data);
  },
  departmentManagerSummary: async (): Promise<DepartmentManagerSummary> => {
    const response = await apiClient.get<DepartmentManagerSummary>('/dashboard/department-manager/summary');
    return normalizeDepartmentManagerSummary(response.data);
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
    return normalizePaginatedResponse<SystemAdminProfile>(response.data);
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
    return normalizePaginatedResponse<Company>(response.data);
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
    return normalizePaginatedResponse<CompanyHeadProfile>(response.data);
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
    return normalizePaginatedResponse<Department>(response.data);
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
    return normalizePaginatedResponse<DepartmentManagerProfile>(response.data);
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
    return normalizePaginatedResponse<User>(response.data);
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/super-admins/${id}`);
  },
};

export const employeesApi = {
  list: async (query: ListQuery): Promise<PaginatedResponse<EmployeeProfile>> => {
    const response = await apiClient.get<PaginatedResponse<EmployeeProfile>>('/employees', { params: toListParams(query) });
    return normalizePaginatedResponse<EmployeeProfile>(response.data);
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
