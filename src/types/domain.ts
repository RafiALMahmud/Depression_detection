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

export type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending';

export interface FlaggedEmployeeEntry {
  anonymized_id: string;
  threshold_tier: string;
  composite_score: number | null;
  facial_score: number | null;
  questionnaire_score: number | null;
  sessions_count: number;
}

export interface DepartmentReportSummary {
  total_employees: number;
  flagged_count: number;
  compliant_count: number;
  average_composite_score: number | null;
}

export interface ReportPreview {
  department_id: number;
  company_id: number;
  department_summary: DepartmentReportSummary;
  flagged_employees: FlaggedEmployeeEntry[];
  next_version: number;
}

export interface ReportRead {
  id: number;
  department_id: number;
  company_id: number;
  manager_name: string | null;
  version: number;
  assessment: string | null;
  behavioral_patterns: string | null;
  recommended_interventions: string | null;
  flagged_employee_count: number;
  department_summary: DepartmentReportSummary | null;
  flagged_employees_data: FlaggedEmployeeEntry[] | null;
  status: string;
  submitted_at: string;
  created_at: string;
}

export interface ReportListResponse {
  items: ReportRead[];
  total: number;
}

export interface EmployeeComplianceEntry {
  employee_id: number;
  full_name: string;
  email: string;
  compliance_status: ComplianceStatus;
  sessions_this_week: number;
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

export interface MoodScore {
  label: string;
  confidence: number;
}

export interface LiveEmotionResult {
  dominant_label: string;
  dominant_confidence: number;
  scores: MoodScore[];
}

export interface FrameMoodPrediction {
  frame_index: number;
  dominant_label: string;
  dominant_confidence: number;
  scores: MoodScore[];
}

export interface VisionPredictionResult {
  model_name: string;
  frame_count: number;
  dominant_label: string;
  dominant_confidence: number;
  averaged_scores: MoodScore[];
  frames: FrameMoodPrediction[];
}

export interface VisionModelStatus {
  ready: boolean;
  message: string;
  architecture: string;
  weights_path: string;
  weights_found: boolean;
  input_size: number;
  max_frames_per_request: number;
  class_labels: string[];
  load_error: string | null;
}

// ---------- Questionnaire types ----------

export type ThresholdTier = 'low' | 'moderate' | 'high' | 'severe';

export interface QuestionOption {
  label: string;
  score: number;
}

export interface QuestionOut {
  id: string;
  text: string;
  domain: string;
  options: QuestionOption[];
  sequence_order: number;
  total_estimated: number;
}

export interface StartSessionResponse {
  session_id: number;
  first_question: QuestionOut;
}

export interface SubmitAnswerResponse {
  is_complete: boolean;
  next_question: QuestionOut | null;
  questionnaire_score: number | null;
  composite_score: number | null;
  threshold_tier: ThresholdTier | null;
}

export interface AnswerDetail {
  question_id: string;
  question_text: string;
  domain: string;
  answer_index: number;
  answer_label: string;
  score: number;
  sequence_order: number;
}

export interface SessionDetail {
  session_id: number;
  facial_score: number | null;
  facial_emotions: Record<string, unknown> | null;
  questionnaire_score: number | null;
  composite_score: number | null;
  threshold_tier: ThresholdTier | null;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  questions_and_answers: AnswerDetail[];
}

export interface SessionListItem {
  session_id: number;
  facial_score: number | null;
  questionnaire_score: number | null;
  composite_score: number | null;
  threshold_tier: ThresholdTier | null;
  status: string;
  created_at: string | null;
  completed_at: string | null;
}

export interface SessionListResponse {
  items: SessionListItem[];
  meta: PaginationMeta;
}
