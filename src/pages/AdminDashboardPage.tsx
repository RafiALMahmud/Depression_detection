import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  companiesApi,
  companyHeadsApi,
  consultantApi,
  dashboardApi,
  departmentManagersApi,
  departmentsApi,
  employeesApi,
  invitationsApi,
  optionsApi,
  questionnaireApi,
  superAdminApi,
  systemAdminApi,
  type CompanyHeadPayload,
  type CompanyHeadUpdatePayload,
  type DepartmentManagerPayload,
  type DepartmentManagerUpdatePayload,
  type EmployeePayload,
  type EmployeeUpdatePayload,
  type ListQuery,
  type SystemAdminCreatePayload,
  type SystemAdminUpdatePayload,
} from '../api/services';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { EntitySection } from '../components/dashboard/EntitySection';
import { StatsCard } from '../components/dashboard/StatsCard';
import type { FormFieldConfig, RowAction, TableColumn } from '../components/dashboard/types';
import type {
  Company,
  CompanyHeadProfile,
  CompanyOption,
  ConsultantProfile,
  Department,
  DepartmentManagerProfile,
  DepartmentOption,
  EmployeeProfile,
  SuperAdminSummary,
  ScoringConfig,
  SystemAdminProfile,
  SystemAdminSummary,
  User,
} from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type DashboardMode = 'super' | 'system';
type FormValues = Record<string, string | boolean>;
type InviteManagedProfile = CompanyHeadProfile | DepartmentManagerProfile | EmployeeProfile;
type UserLike = {
  full_name?: string;
  email?: string;
  is_active?: boolean;
} | null | undefined;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PRIMARY_SUPER_ADMIN_EMAIL = 'rafi.almahmud.007@gmail.com';

const activeField: FormFieldConfig = {
  name: 'is_active',
  label: 'Active',
  type: 'checkbox',
  hiddenOnCreate: true,
};

const validateEmail = (email: string): boolean => EMAIL_PATTERN.test(email.trim());

const renderInvitationBadge = (item: InviteManagedProfile): ReactNode => {
  const badge = (label: string, classes: string) => (
    <span className={`mw-badge ${classes}`}>{label}</span>
  );

  if (Boolean(item.user?.is_active)) return badge('Active', 'mw-badge-success');
  const status = item.invitation?.status;
  if (!status || status === 'pending') return badge('Pending', 'mw-badge-warning');
  if (status === 'used') return badge('Used', 'mw-badge-info');
  if (status === 'expired') return badge('Expired', 'mw-badge-danger');
  if (status === 'cancelled') return badge('Cancelled', 'mw-badge-muted');
  return badge(status, 'mw-badge-muted');
};

const getUserName = (user: UserLike): string => user?.full_name?.trim() || 'Unknown user';
const getUserEmail = (user: UserLike): string => user?.email?.trim() || '-';
const isUserActive = (user: UserLike): boolean => Boolean(user?.is_active);

const validateSystemAdminForm = (values: FormValues, mode: 'create' | 'edit'): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!String(values.full_name ?? '').trim()) errors.full_name = 'Full name is required';
  if (!String(values.email ?? '').trim()) {
    errors.email = 'Email is required';
  } else if (!validateEmail(String(values.email))) {
    errors.email = 'Invalid email format';
  }
  const password = String(values.password ?? '');
  if (mode === 'create' && !password) errors.password = 'Password is required';
  if (password && password.length < 8) errors.password = 'Password must be at least 8 characters';
  return errors;
};

const validateInvitedForm = (values: FormValues, _mode: 'create' | 'edit'): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!String(values.full_name ?? '').trim()) errors.full_name = 'Full name is required';
  if (!String(values.email ?? '').trim()) {
    errors.email = 'Email is required';
  } else if (!validateEmail(String(values.email))) {
    errors.email = 'Invalid email format';
  }
  return errors;
};

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string }; status?: number } }).response;
    if (response?.data?.detail) return response.data.detail;
    if (response?.status === 401 || response?.status === 403) return 'Your session no longer has access.';
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_NETWORK'
  ) {
    return 'Cannot reach MindWell API. Check backend connection and retry.';
  }
  return fallback;
};

interface AdminDashboardPageProps {
  mode: DashboardMode;
}

export const AdminDashboardPage = ({ mode }: AdminDashboardPageProps) => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const isSuperMode = mode === 'super';

  const [activeSectionId, setActiveSectionId] = useState<string>('overview');
  const [summary, setSummary] = useState<SuperAdminSummary | SystemAdminSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [lookupLoading, setLookupLoading] = useState<boolean>(true);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [sectionReloadKey, setSectionReloadKey] = useState(0);
  const summaryRunRef = useRef(0);
  const lookupRunRef = useRef(0);
  const scoringRunRef = useRef(0);

  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);
  const [scoringForm, setScoringForm] = useState<{ facial_weight: string; questionnaire_weight: string }>({
    facial_weight: '0.5',
    questionnaire_weight: '0.5',
  });
  const [scoringLoading, setScoringLoading] = useState(false);
  const [scoringSaving, setScoringSaving] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);

  const allowed = useMemo(() => {
    if (!user) return false;
    return isSuperMode ? user.role === 'super_admin' : user.role === 'system_admin';
  }, [isSuperMode, user]);

  const isPrimarySuperAdmin = useMemo(() => {
    if (!user || user.role !== 'super_admin') return false;
    return user.email.trim().toLowerCase() === PRIMARY_SUPER_ADMIN_EMAIL;
  }, [user]);

  useEffect(() => {
    if (user) {
      if (isSuperMode && user.role !== 'super_admin') navigate(getDashboardPathByRole(user.role), { replace: true });
      if (!isSuperMode && user.role !== 'system_admin') navigate(getDashboardPathByRole(user.role), { replace: true });
    }
  }, [user, isSuperMode, navigate]);

  const loadSummary = useCallback(async () => {
    const runId = ++summaryRunRef.current;
    setSummaryLoading(true);
    setSummaryError(null);
    if (import.meta.env.DEV) {
      console.info('[MindWell][Dashboard] summary:load:start', { mode });
    }
    try {
      const response = isSuperMode ? await dashboardApi.superAdminSummary() : await dashboardApi.systemAdminSummary();
      if (runId !== summaryRunRef.current) {
        return;
      }
      setSummary(response);
      if (import.meta.env.DEV) {
        console.info('[MindWell][Dashboard] summary:load:success', { mode });
      }
    } catch (error) {
      if (runId !== summaryRunRef.current) {
        return;
      }
      const message = getApiErrorMessage(error, 'Failed to load dashboard summary');
      setSummaryError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (runId === summaryRunRef.current) {
        setSummaryLoading(false);
      }
    }
  }, [isSuperMode, mode]);

  const loadLookupOptions = useCallback(async () => {
    const runId = ++lookupRunRef.current;
    setLookupLoading(true);
    setLookupError(null);
    if (import.meta.env.DEV) {
      console.info('[MindWell][Dashboard] lookup:load:start');
    }
    try {
      const [companies, departments] = await Promise.all([optionsApi.companies(), optionsApi.departments()]);
      if (runId !== lookupRunRef.current) {
        return;
      }
      setCompanyOptions(companies);
      setDepartmentOptions(departments);
      if (import.meta.env.DEV) {
        console.info('[MindWell][Dashboard] lookup:load:success', {
          companies: companies.length,
          departments: departments.length,
        });
      }
    } catch (error) {
      if (runId !== lookupRunRef.current) {
        return;
      }
      const message = getApiErrorMessage(error, 'Failed to load form options');
      setLookupError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (runId === lookupRunRef.current) {
        setLookupLoading(false);
      }
    }
  }, []);

  const loadScoringConfig = useCallback(async () => {
    const runId = ++scoringRunRef.current;
    setScoringLoading(true);
    setScoringError(null);
    try {
      const response = await questionnaireApi.getScoringConfig();
      if (runId !== scoringRunRef.current) return;
      setScoringConfig(response);
      setScoringForm({
        facial_weight: String(response.facial_weight),
        questionnaire_weight: String(response.questionnaire_weight),
      });
    } catch (error) {
      if (runId !== scoringRunRef.current) return;
      setScoringError(getApiErrorMessage(error, 'Failed to load scoring configuration.'));
    } finally {
      if (runId === scoringRunRef.current) setScoringLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void Promise.all([loadSummary(), loadLookupOptions(), loadScoringConfig()]);
  }, [allowed, loadSummary, loadLookupOptions, loadScoringConfig]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[MindWell][Dashboard] state', {
      mode,
      activeSectionId,
      allowed,
      summaryLoading,
      hasSummaryError: Boolean(summaryError),
      lookupLoading,
      hasLookupError: Boolean(lookupError),
    });
  }, [mode, activeSectionId, allowed, summaryLoading, summaryError, lookupLoading, lookupError]);

  const companyNameMap = useMemo(() => new Map(companyOptions.map((item) => [item.id, item.name])), [companyOptions]);
  const departmentNameMap = useMemo(() => new Map(departmentOptions.map((item) => [item.id, item.name])), [departmentOptions]);

  const companySelectOptions = useMemo(
    () => companyOptions.map((company) => ({ value: String(company.id), label: `${company.name} (${company.code})` })),
    [companyOptions],
  );

  const getDepartmentOptionsByCompany = useCallback(
    (companyIdRaw: string | boolean | undefined) => {
      const companyId = Number(companyIdRaw);
      if (!companyId) return [];
      return departmentOptions
        .filter((department) => department.company_id === companyId)
        .map((department) => ({ value: String(department.id), label: `${department.name} (${department.code})` }));
    },
    [departmentOptions],
  );

  const refreshAfterCrud = useCallback(async () => {
    await Promise.all([loadSummary(), loadLookupOptions()]);
  }, [loadSummary, loadLookupOptions]);

  const bumpSectionReload = useCallback(() => {
    setSectionReloadKey((prev) => prev + 1);
  }, []);

  const handleInvitationResend = useCallback(
    async (invitationId: number) => {
      try {
        await invitationsApi.resend(invitationId);
        toast.success('Invitation sent successfully');
        await refreshAfterCrud();
        bumpSectionReload();
      } catch (error) {
        const message =
          typeof error === 'object' && error !== null && 'response' in error
            ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
        toast.error(message || 'Failed to resend invitation');
      }
    },
    [bumpSectionReload, refreshAfterCrud],
  );

  const handleInvitationCancel = useCallback(
    async (invitationId: number) => {
      try {
        await invitationsApi.cancel(invitationId);
        toast.success('Invitation cancelled successfully');
        await refreshAfterCrud();
        bumpSectionReload();
      } catch (error) {
        const message =
          typeof error === 'object' && error !== null && 'response' in error
            ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
        toast.error(message || 'Failed to cancel invitation');
      }
    },
    [bumpSectionReload, refreshAfterCrud],
  );

  const invitationRowActions = useCallback(
    <T extends InviteManagedProfile>(): RowAction<T>[] => [
      {
        key: 'resend',
        label: 'Resend',
        variant: 'success',
        onClick: (item) => {
          const invitationId = item.invitation?.id;
          if (!invitationId) return;
          void handleInvitationResend(invitationId);
        },
        hidden: (item) => !item.invitation || isUserActive(item.user) || item.invitation.status === 'used',
      },
      {
        key: 'cancel',
        label: 'Cancel',
        variant: 'danger',
        onClick: (item) => {
          const invitationId = item.invitation?.id;
          if (!invitationId) return;
          void handleInvitationCancel(invitationId);
        },
        hidden: (item) => !item.invitation || isUserActive(item.user) || item.invitation.status !== 'pending',
      },
    ],
    [handleInvitationCancel, handleInvitationResend],
  );

  const sections = isSuperMode
    ? [
        { id: 'overview', label: 'Overview' },
        { id: 'scoring-config', label: 'Scoring Config' },
        ...(isPrimarySuperAdmin ? [{ id: 'super-admins', label: 'Super Admins' }] : []),
        { id: 'system-admins', label: 'System Admins' },
        { id: 'companies', label: 'Companies' },
        { id: 'company-heads', label: 'Company Heads' },
        { id: 'departments', label: 'Departments' },
        { id: 'department-managers', label: 'Department Managers' },
        { id: 'employees', label: 'Employees' },
        { id: 'consultants', label: 'Consultants' },
      ]
    : [
        { id: 'overview', label: 'Overview' },
        { id: 'scoring-config', label: 'Scoring Config' },
        { id: 'companies', label: 'Companies' },
        { id: 'company-heads', label: 'Company Heads' },
        { id: 'departments', label: 'Departments' },
        { id: 'department-managers', label: 'Department Managers' },
        { id: 'employees', label: 'Employees' },
        { id: 'consultants', label: 'Consultants' },
      ];

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId('overview');
    }
  }, [activeSectionId, sections]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!allowed) return <Navigate to={getDashboardPathByRole(user.role)} replace />;

  const renderOverview = () => {
    if (summaryLoading) {
      return <div className="mw-card mw-loading-card">Loading overview...</div>;
    }
    if (summaryError) {
      return (
        <div className="mw-card mw-empty-state">
          <h3>Overview unavailable</h3>
          <p>{summaryError}</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadSummary();
            }}
          >
            Retry overview load
          </button>
        </div>
      );
    }
    if (!summary) {
      return (
        <div className="mw-card mw-empty-state">
          <h3>Overview not ready</h3>
          <p>Dashboard summary data was empty. Please retry.</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadSummary();
            }}
          >
            Retry overview load
          </button>
        </div>
      );
    }

    const cards = isSuperMode
      ? [
          { label: 'Total System Admins', value: (summary as SuperAdminSummary).total_system_admins },
          { label: 'Total Companies', value: summary.total_companies },
          { label: 'Total Company Heads', value: summary.total_company_heads },
          { label: 'Total Departments', value: summary.total_departments },
          { label: 'Total Department Managers', value: summary.total_department_managers },
          { label: 'Total Employees', value: summary.total_employees },
        ]
      : [
          { label: 'Total Companies', value: summary.total_companies },
          { label: 'Total Company Heads', value: summary.total_company_heads },
          { label: 'Total Departments', value: summary.total_departments },
          { label: 'Total Department Managers', value: summary.total_department_managers },
          { label: 'Total Employees', value: summary.total_employees },
        ];

    return (
      <section className="mw-stat-grid">
        {cards.map((card) => (
          <StatsCard key={card.label} label={card.label} value={card.value} />
        ))}
      </section>
    );
  };

  const saveScoringConfig = useCallback(async () => {
    const facialWeight = Number(scoringForm.facial_weight);
    const questionnaireWeight = Number(scoringForm.questionnaire_weight);

    if (!Number.isFinite(facialWeight) || !Number.isFinite(questionnaireWeight)) {
      setScoringError('Both weights must be valid numbers.');
      return;
    }
    if (facialWeight < 0 || questionnaireWeight < 0) {
      setScoringError('Weights must be zero or positive.');
      return;
    }
    if (facialWeight > 1 || questionnaireWeight > 1) {
      setScoringError('Each weight must be between 0 and 1.');
      return;
    }
    if (facialWeight + questionnaireWeight <= 0) {
      setScoringError('At least one weight must be greater than zero.');
      return;
    }

    setScoringSaving(true);
    setScoringError(null);
    try {
      const updated = await questionnaireApi.updateScoringConfig({
        facial_weight: facialWeight,
        questionnaire_weight: questionnaireWeight,
      });
      setScoringConfig(updated);
      setScoringForm({
        facial_weight: String(updated.facial_weight),
        questionnaire_weight: String(updated.questionnaire_weight),
      });
      toast.success('Composite score weights updated.');
    } catch (error) {
      setScoringError(getApiErrorMessage(error, 'Failed to update scoring configuration.'));
    } finally {
      setScoringSaving(false);
    }
  }, [scoringForm.facial_weight, scoringForm.questionnaire_weight]);

  const resetScoringConfigForm = useCallback(() => {
    if (!scoringConfig) return;
    setScoringForm({
      facial_weight: String(scoringConfig.facial_weight),
      questionnaire_weight: String(scoringConfig.questionnaire_weight),
    });
    setScoringError(null);
  }, [scoringConfig]);

  const renderScoringConfig = () => {
    const facialWeight = Number(scoringForm.facial_weight || 0);
    const questionnaireWeight = Number(scoringForm.questionnaire_weight || 0);
    const facialPercent = Number.isFinite(facialWeight) ? Math.round(facialWeight * 100) : 0;
    const questionnairePercent = Number.isFinite(questionnaireWeight) ? Math.round(questionnaireWeight * 100) : 0;

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Composite Algorithm</p>
              <h2 className="mw-entity-title">Depression Score Weights</h2>
              <p className="mw-entity-description">
                Configure how Facial Mood Score and Questionnaire Score are fused into the 0-100 composite score.
                Default is 50/50.
              </p>
            </div>
          </div>
        </div>

        <article className="mw-card mw-info-panel">
          {scoringLoading ? (
            <div className="mw-loading-card">Loading scoring configuration...</div>
          ) : (
            <>
              <div className="mw-form-actions-row">
                <label className="mw-field">
                  <span className="mw-field-label">Facial Weight (0 to 1)</span>
                  <input
                    className="mw-input"
                    type="number"
                    min={0}
                    max={1}
                    step="0.01"
                    value={scoringForm.facial_weight}
                    onChange={(event) => setScoringForm((prev) => ({ ...prev, facial_weight: event.target.value }))}
                  />
                </label>
                <label className="mw-field">
                  <span className="mw-field-label">Questionnaire Weight (0 to 1)</span>
                  <input
                    className="mw-input"
                    type="number"
                    min={0}
                    max={1}
                    step="0.01"
                    value={scoringForm.questionnaire_weight}
                    onChange={(event) =>
                      setScoringForm((prev) => ({ ...prev, questionnaire_weight: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="mw-inline-summary">
                <span className="mw-badge mw-badge-info">Facial {facialPercent}%</span>
                <span className="mw-badge mw-badge-success">Questionnaire {questionnairePercent}%</span>
                <span className="mw-helper-text">
                  Tiers: Low 0-25, Moderate 26-50, High 51-75, Severe 76-100
                </span>
              </div>

              {scoringConfig?.updated_at ? (
                <p className="mw-helper-text" style={{ marginTop: '10px' }}>
                  Last updated at {new Date(scoringConfig.updated_at).toLocaleString()}
                </p>
              ) : null}

              {scoringError ? (
                <div className="mw-scan-message-card danger" style={{ marginTop: '14px' }}>
                  <h4>Configuration Error</h4>
                  <p>{scoringError}</p>
                </div>
              ) : null}

              <div className="mw-info-panel-actions" style={{ marginTop: '16px' }}>
                <button type="button" className="mw-btn-primary" onClick={() => void saveScoringConfig()} disabled={scoringSaving}>
                  {scoringSaving ? 'Saving...' : 'Save Weights'}
                </button>
                <button
                  type="button"
                  className="mw-btn-ghost"
                  onClick={resetScoringConfigForm}
                  disabled={scoringSaving || !scoringConfig}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="mw-btn-ghost"
                  onClick={() => {
                    void loadScoringConfig();
                  }}
                  disabled={scoringSaving || scoringLoading}
                >
                  Refresh
                </button>
              </div>
            </>
          )}
        </article>
      </section>
    );
  };

  const systemAdminColumns: TableColumn<SystemAdminProfile>[] = [
    { key: 'full_name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    { key: 'status', title: 'Status', render: (item) => (isUserActive(item.user) ? 'Active' : 'Inactive') },
    { key: 'created_at', title: 'Created', render: (item) => new Date(item.created_at).toLocaleDateString() },
  ];

  const superAdminColumns: TableColumn<User>[] = [
    { key: 'full_name', title: 'Name', render: (item) => item.full_name },
    { key: 'email', title: 'Email', render: (item) => item.email },
    { key: 'status', title: 'Status', render: (item) => (item.is_active ? 'Active' : 'Inactive') },
    { key: 'created_at', title: 'Created', render: (item) => new Date(item.created_at).toLocaleDateString() },
  ];

  const systemAdminFields: FormFieldConfig[] = [
    { name: 'full_name', label: 'Full Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'password', label: 'Password', type: 'password', required: true, hiddenOnEdit: true },
    { ...activeField, hiddenOnCreate: false },
  ];

  const companyColumns: TableColumn<Company>[] = [
    { key: 'name', title: 'Company Name', render: (item) => item.name },
    { key: 'code', title: 'Code', render: (item) => item.code },
    { key: 'description', title: 'Description', render: (item) => item.description || '-' },
    { key: 'status', title: 'Status', render: (item) => (item.is_active ? 'Active' : 'Inactive') },
  ];

  const companyFields: FormFieldConfig[] = [
    { name: 'name', label: 'Company Name', type: 'text', required: true },
    { name: 'code', label: 'Code', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
    { ...activeField, hiddenOnCreate: false },
  ];

  const companyHeadColumns: TableColumn<CompanyHeadProfile>[] = [
    { key: 'full_name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    { key: 'company', title: 'Company', render: (item) => companyNameMap.get(item.company_id) ?? `#${item.company_id}` },
    { key: 'onboarding', title: 'Onboarding', render: (item) => renderInvitationBadge(item) },
  ];

  const companyHeadFields: FormFieldConfig[] = [
    { name: 'full_name', label: 'Full Name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'company_id', label: 'Company', type: 'select', required: true, options: companySelectOptions },
    activeField,
  ];

  const departmentColumns: TableColumn<Department>[] = [
    { key: 'name', title: 'Department Name', render: (item) => item.name },
    { key: 'code', title: 'Code', render: (item) => item.code },
    { key: 'company', title: 'Company', render: (item) => companyNameMap.get(item.company_id) ?? `#${item.company_id}` },
    { key: 'status', title: 'Status', render: (item) => (item.is_active ? 'Active' : 'Inactive') },
  ];

  const departmentFields: FormFieldConfig[] = [
    { name: 'company_id', label: 'Company', type: 'select', required: true, options: companySelectOptions },
    { name: 'name', label: 'Department Name', type: 'text', required: true },
    { name: 'code', label: 'Department Code', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
    { ...activeField, hiddenOnCreate: false },
  ];

  const managerColumns: TableColumn<DepartmentManagerProfile>[] = [
    { key: 'name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    { key: 'company', title: 'Company', render: (item) => companyNameMap.get(item.company_id) ?? `#${item.company_id}` },
    { key: 'department', title: 'Department', render: (item) => departmentNameMap.get(item.department_id) ?? `#${item.department_id}` },
    { key: 'onboarding', title: 'Onboarding', render: (item) => renderInvitationBadge(item) },
  ];

  const employeeColumns: TableColumn<EmployeeProfile>[] = [
    { key: 'name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    { key: 'company', title: 'Company', render: (item) => companyNameMap.get(item.company_id) ?? `#${item.company_id}` },
    { key: 'department', title: 'Department', render: (item) => departmentNameMap.get(item.department_id) ?? `#${item.department_id}` },
    { key: 'code', title: 'Employee Code', render: (item) => item.employee_code || '-' },
    { key: 'job_title', title: 'Job Title', render: (item) => item.job_title || '-' },
    { key: 'onboarding', title: 'Onboarding', render: (item) => renderInvitationBadge(item) },
  ];

  const requiresLookupOptions = ['company-heads', 'departments', 'department-managers', 'employees'].includes(
    activeSectionId,
  );

  const entityComponent = () => {
    if (activeSectionId === 'overview') {
      return renderOverview();
    }

    if (activeSectionId === 'scoring-config') {
      return renderScoringConfig();
    }

    if (requiresLookupOptions && lookupLoading) {
      return <div className="mw-card mw-loading-card">Loading companies and departments...</div>;
    }

    if (requiresLookupOptions && lookupError) {
      return (
        <div className="mw-card mw-empty-state">
          <h3>Form options unavailable</h3>
          <p>{lookupError}</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadLookupOptions();
            }}
          >
            Retry option load
          </button>
        </div>
      );
    }

    if (activeSectionId === 'super-admins' && isSuperMode && isPrimarySuperAdmin) {
      return (
        <EntitySection<User>
          title="Super Admin"
          description="Primary super admin can remove any super admin account."
          showCreateButton={false}
          enableEdit={false}
          columns={superAdminColumns}
          fields={[]}
          reloadKey={sectionReloadKey}
          fetchItems={(query) => superAdminApi.list(query)}
          createItem={async () => ({})}
          updateItem={async () => ({})}
          deleteItem={(id) => superAdminApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => item.email}
          toFormValues={() => ({})}
          toCreatePayload={() => ({})}
          toUpdatePayload={() => ({})}
          deleteSuccessMessage="Super admin removed successfully"
          onAfterChange={refreshAfterCrud}
        />
      );
    }

    if (activeSectionId === 'system-admins' && isSuperMode) {
      return (
        <EntitySection<SystemAdminProfile>
          title="System Admin"
          description="Manage system administrator accounts (Super Admin only)."
          columns={systemAdminColumns}
          fields={systemAdminFields}
          reloadKey={sectionReloadKey}
          fetchItems={(query) => systemAdminApi.list(query)}
          createItem={(payload) => systemAdminApi.create(payload as SystemAdminCreatePayload)}
          updateItem={(id, payload) => systemAdminApi.update(id, payload as SystemAdminUpdatePayload)}
          deleteItem={(id) => systemAdminApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            password: '',
            is_active: item?.user?.is_active ?? true,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            password: String(values.password),
            is_active: Boolean(values.is_active),
          })}
          toUpdatePayload={(values) => {
            return {
              full_name: String(values.full_name).trim(),
              email: String(values.email).trim(),
              is_active: Boolean(values.is_active),
            };
          }}
          validate={(values, modeArg) => validateSystemAdminForm(values, modeArg)}
          onAfterChange={refreshAfterCrud}
        />
      );
    }

    if (activeSectionId === 'companies') {
      return (
        <EntitySection<Company>
          title="Company"
          description="Create and manage company profiles and hierarchy roots."
          columns={companyColumns}
          fields={companyFields}
          reloadKey={sectionReloadKey}
          fetchItems={(query) => companiesApi.list(query)}
          createItem={(payload) => companiesApi.create(payload as { name: string; code: string; description?: string; is_active: boolean })}
          updateItem={(id, payload) =>
            companiesApi.update(id, payload as Partial<{ name: string; code: string; description?: string; is_active: boolean }>)
          }
          deleteItem={(id) => companiesApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => item.name}
          toFormValues={(item) => ({
            name: item?.name ?? '',
            code: item?.code ?? '',
            description: item?.description ?? '',
            is_active: item?.is_active ?? true,
          })}
          toCreatePayload={(values) => ({
            name: String(values.name).trim(),
            code: String(values.code).trim().toUpperCase(),
            description: String(values.description || '').trim() || null,
            is_active: Boolean(values.is_active),
          })}
          toUpdatePayload={(values) => ({
            name: String(values.name).trim(),
            code: String(values.code).trim().toUpperCase(),
            description: String(values.description || '').trim() || null,
            is_active: Boolean(values.is_active),
          })}
          validate={(values) => {
            const errors: Record<string, string> = {};
            if (!String(values.name ?? '').trim()) errors.name = 'Company name is required';
            if (!String(values.code ?? '').trim()) errors.code = 'Company code is required';
            return errors;
          }}
          onAfterChange={refreshAfterCrud}
        />
      );
    }

    if (activeSectionId === 'company-heads') {
      return (
        <EntitySection<CompanyHeadProfile>
          title="Company Head"
          description="Choose a company first, then invite a company head via email code onboarding."
          createButtonLabel="Invite Company Head"
          columns={companyHeadColumns}
          fields={companyHeadFields}
          reloadKey={sectionReloadKey}
          filters={[{ key: 'companyId', label: 'Company Filter', options: companySelectOptions }]}
          rowActions={invitationRowActions<CompanyHeadProfile>()}
          fetchItems={(query: ListQuery) => companyHeadsApi.list(query)}
          createItem={(payload) => companyHeadsApi.create(payload as CompanyHeadPayload)}
          updateItem={(id, payload) => companyHeadsApi.update(id, payload as CompanyHeadUpdatePayload)}
          deleteItem={(id) => companyHeadsApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            company_id: item ? String(item.company_id) : '',
            is_active: item?.user?.is_active ?? false,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: Number(values.company_id),
          })}
          toUpdatePayload={(values) => {
            return {
              full_name: String(values.full_name).trim(),
              email: String(values.email).trim(),
              company_id: Number(values.company_id),
              is_active: Boolean(values.is_active),
            };
          }}
          validate={(values, modeArg) => {
            const errors = validateInvitedForm(values, modeArg);
            if (!String(values.company_id ?? '').trim()) errors.company_id = 'Company is required';
            return errors;
          }}
          createSuccessMessage="Invitation sent successfully"
          onAfterChange={refreshAfterCrud}
        />
      );
    }

    if (activeSectionId === 'departments') {
      return (
        <EntitySection<Department>
          title="Department"
          description="Manage departments under each company."
          columns={departmentColumns}
          fields={departmentFields}
          reloadKey={sectionReloadKey}
          filters={[{ key: 'companyId', label: 'Company Filter', options: companySelectOptions }]}
          fetchItems={(query: ListQuery) => departmentsApi.list(query)}
          createItem={(payload) =>
            departmentsApi.create(payload as { company_id: number; name: string; code: string; description?: string; is_active: boolean })
          }
          updateItem={(id, payload) =>
            departmentsApi.update(
              id,
              payload as Partial<{ company_id: number; name: string; code: string; description?: string; is_active: boolean }>,
            )
          }
          deleteItem={(id) => departmentsApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => item.name}
          toFormValues={(item) => ({
            company_id: item ? String(item.company_id) : '',
            name: item?.name ?? '',
            code: item?.code ?? '',
            description: item?.description ?? '',
            is_active: item?.is_active ?? true,
          })}
          toCreatePayload={(values) => ({
            company_id: Number(values.company_id),
            name: String(values.name).trim(),
            code: String(values.code).trim().toUpperCase(),
            description: String(values.description || '').trim() || null,
            is_active: Boolean(values.is_active),
          })}
          toUpdatePayload={(values) => ({
            company_id: Number(values.company_id),
            name: String(values.name).trim(),
            code: String(values.code).trim().toUpperCase(),
            description: String(values.description || '').trim() || null,
            is_active: Boolean(values.is_active),
          })}
          validate={(values) => {
            const errors: Record<string, string> = {};
            if (!String(values.company_id ?? '').trim()) errors.company_id = 'Company is required';
            if (!String(values.name ?? '').trim()) errors.name = 'Department name is required';
            if (!String(values.code ?? '').trim()) errors.code = 'Department code is required';
            return errors;
          }}
          onAfterChange={refreshAfterCrud}
        />
      );
    }

    if (activeSectionId === 'department-managers') {
      return (
        <EntitySection<DepartmentManagerProfile>
          title="Department Manager"
          description="Choose company first, then department, then send invitation onboarding."
          createButtonLabel="Invite Department Manager"
          columns={managerColumns}
          fields={(values) => [
            { name: 'full_name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'company_id', label: 'Company', type: 'select', required: true, options: companySelectOptions },
            {
              name: 'department_id',
              label: 'Department',
              type: 'select',
              required: true,
              options: getDepartmentOptionsByCompany(values.company_id),
              placeholder: String(values.company_id ?? '').trim() ? 'Select a department' : 'Select company first',
              disabled: !String(values.company_id ?? '').trim(),
            },
            activeField,
          ]}
          reloadKey={sectionReloadKey}
          filters={[
            { key: 'companyId', label: 'Company Filter', options: companySelectOptions },
            {
              key: 'departmentId',
              label: 'Department Filter',
              options: (filterState) => getDepartmentOptionsByCompany(filterState.companyId),
              dependsOn: 'companyId',
              dependsOnLabel: 'company',
            },
          ]}
          rowActions={invitationRowActions<DepartmentManagerProfile>()}
          fetchItems={(query: ListQuery) => departmentManagersApi.list(query)}
          createItem={(payload) => departmentManagersApi.create(payload as DepartmentManagerPayload)}
          updateItem={(id, payload) => departmentManagersApi.update(id, payload as DepartmentManagerUpdatePayload)}
          deleteItem={(id) => departmentManagersApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            company_id: item ? String(item.company_id) : '',
            department_id: item ? String(item.department_id) : '',
            is_active: item?.user?.is_active ?? false,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: Number(values.company_id),
            department_id: Number(values.department_id),
          })}
          toUpdatePayload={(values) => {
            return {
              full_name: String(values.full_name).trim(),
              email: String(values.email).trim(),
              company_id: Number(values.company_id),
              department_id: Number(values.department_id),
              is_active: Boolean(values.is_active),
            };
          }}
          validate={(values, modeArg) => {
            const errors = validateInvitedForm(values, modeArg);
            if (!String(values.company_id ?? '').trim()) errors.company_id = 'Company is required';
            if (!String(values.department_id ?? '').trim()) errors.department_id = 'Department is required';
            const selectedDepartment = departmentOptions.find((department) => department.id === Number(values.department_id || 0));
            if (
              selectedDepartment &&
              Number(values.company_id || 0) &&
              selectedDepartment.company_id !== Number(values.company_id || 0)
            ) {
              errors.department_id = 'Department must belong to selected company';
            }
            return errors;
          }}
          createSuccessMessage="Invitation sent successfully"
          onAfterChange={refreshAfterCrud}
          transformValuesOnChange={(name, value, previousValues) => {
            const nextValues = { ...previousValues, [name]: value };
            if (name === 'company_id') {
              const allowedDepartments = getDepartmentOptionsByCompany(value);
              const hasDepartment = allowedDepartments.some((option) => option.value === String(nextValues.department_id ?? ''));
              if (!hasDepartment) nextValues.department_id = '';
            }
            return nextValues;
          }}
        />
      );
    }

    if (activeSectionId === 'employees') {
      return (
        <EntitySection<EmployeeProfile>
          title="Employee"
          description="Choose company first, then department. Employee code is auto-generated during invitation onboarding."
          createButtonLabel="Invite Employee"
          columns={employeeColumns}
          fields={(values) => [
            { name: 'full_name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'company_id', label: 'Company', type: 'select', required: true, options: companySelectOptions },
            {
              name: 'department_id',
              label: 'Department',
              type: 'select',
              required: true,
              options: getDepartmentOptionsByCompany(values.company_id),
              placeholder: String(values.company_id ?? '').trim() ? 'Select a department' : 'Select company first',
              disabled: !String(values.company_id ?? '').trim(),
            },
            { name: 'job_title', label: 'Job Title', type: 'text' },
            activeField,
          ]}
          reloadKey={sectionReloadKey}
          filters={[
            { key: 'companyId', label: 'Company Filter', options: companySelectOptions },
            {
              key: 'departmentId',
              label: 'Department Filter',
              options: (filterState) => getDepartmentOptionsByCompany(filterState.companyId),
              dependsOn: 'companyId',
              dependsOnLabel: 'company',
            },
          ]}
          rowActions={invitationRowActions<EmployeeProfile>()}
          fetchItems={(query: ListQuery) => employeesApi.list(query)}
          createItem={(payload) => employeesApi.create(payload as EmployeePayload)}
          updateItem={(id, payload) => employeesApi.update(id, payload as EmployeeUpdatePayload)}
          deleteItem={(id) => employeesApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            company_id: item ? String(item.company_id) : '',
            department_id: item ? String(item.department_id) : '',
            job_title: item?.job_title ?? '',
            is_active: item?.user?.is_active ?? false,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: Number(values.company_id),
            department_id: Number(values.department_id),
            job_title: String(values.job_title || '').trim() || null,
          })}
          toUpdatePayload={(values) => {
            return {
              full_name: String(values.full_name).trim(),
              email: String(values.email).trim(),
              company_id: Number(values.company_id),
              department_id: Number(values.department_id),
              job_title: String(values.job_title || '').trim() || null,
              is_active: Boolean(values.is_active),
            };
          }}
          validate={(values, modeArg) => {
            const errors = validateInvitedForm(values, modeArg);
            if (!String(values.company_id ?? '').trim()) errors.company_id = 'Company is required';
            if (!String(values.department_id ?? '').trim()) errors.department_id = 'Department is required';
            const selectedDepartment = departmentOptions.find((department) => department.id === Number(values.department_id || 0));
            if (
              selectedDepartment &&
              Number(values.company_id || 0) &&
              selectedDepartment.company_id !== Number(values.company_id || 0)
            ) {
              errors.department_id = 'Department must belong to selected company';
            }
            return errors;
          }}
          createSuccessMessage="Invitation sent successfully"
          onAfterChange={refreshAfterCrud}
          transformValuesOnChange={(name, value, previousValues) => {
            const nextValues = { ...previousValues, [name]: value };
            if (name === 'company_id') {
              const allowedDepartments = getDepartmentOptionsByCompany(value);
              const hasDepartment = allowedDepartments.some((option) => option.value === String(nextValues.department_id ?? ''));
              if (!hasDepartment) nextValues.department_id = '';
            }
            return nextValues;
          }}
        />
      );
    }

    if (activeSectionId === 'consultants') {
      return (
        <EntitySection<ConsultantProfile>
          title="Consultant"
          description="Invite consultants to provide anonymous employee support within their assigned company."
          createButtonLabel="Invite Consultant"
          columns={[
            { key: 'name', title: 'Name', render: (item) => getUserName(item.user) },
            { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
            { key: 'company', title: 'Company', render: (item) => item.company_name ?? `#${item.company_id}` },
            { key: 'title', title: 'Title', render: (item) => item.professional_title ?? '—' },
            { key: 'specialization', title: 'Specialization', render: (item) => item.specialization ?? '—' },
            { key: 'onboarding', title: 'Onboarding', render: (item) => renderInvitationBadge(item) },
          ]}
          fields={[
            { name: 'full_name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'company_id', label: 'Company', type: 'select', required: true, options: companySelectOptions },
            { name: 'professional_title', label: 'Professional Title', type: 'text' },
            { name: 'specialization', label: 'Specialization', type: 'text' },
            activeField,
          ]}
          reloadKey={sectionReloadKey}
          filters={isSuperMode ? [{ key: 'companyId', label: 'Company Filter', options: companySelectOptions }] : []}
          fetchItems={(query) =>
            consultantApi.list(query.companyId ? Number(query.companyId) : undefined).then((r: { items: ConsultantProfile[]; total: number }) => ({
              items: r.items,
              meta: { page: 1, page_size: r.total, total: r.total, total_pages: 1 },
            }))
          }
          createItem={(payload) => {
            const p = payload as Record<string, unknown>;
            return consultantApi.create({
              full_name: String(p.full_name ?? '').trim(),
              email: String(p.email ?? '').trim(),
              company_id: Number(p.company_id),
              professional_title: String(p.professional_title ?? '').trim() || undefined,
              specialization: String(p.specialization ?? '').trim() || undefined,
            });
          }}
          updateItem={(id, payload) => {
            const p = payload as Record<string, unknown>;
            return consultantApi.update(id, {
              full_name: String(p.full_name ?? '').trim(),
              professional_title: String(p.professional_title ?? '').trim() || undefined,
              specialization: String(p.specialization ?? '').trim() || undefined,
              is_active: p.is_active as boolean | undefined,
            });
          }}
          deleteItem={(id) => consultantApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            company_id: item ? String(item.company_id) : '',
            professional_title: item?.professional_title ?? '',
            specialization: item?.specialization ?? '',
            is_active: item?.user?.is_active ?? true,
          })}
          toCreatePayload={(v) => v}
          toUpdatePayload={(v) => v}
          validate={(values, modeArg) => {
            const errors = validateInvitedForm(values, modeArg);
            if (!String(values.company_id ?? '').trim()) errors.company_id = 'Company is required';
            return errors;
          }}
          createSuccessMessage="Consultant invitation sent"
          onAfterChange={refreshAfterCrud}
        />
      );
    }

    return <div className="mw-card mw-loading-card">Select a section from the sidebar.</div>;
  };

  return (
    <AppShell
      title={isSuperMode ? 'Super Admin Dashboard' : 'System Admin Dashboard'}
      subtitle="A calm, role-based workspace aligned with the MindWell landing design language."
      roleLabel={isSuperMode ? 'Super Admin' : 'System Admin'}
      user={user}
      sections={sections}
      activeSectionId={activeSectionId}
      onSelectSection={setActiveSectionId}
      onLogout={() => {
        void (async () => {
          await signOut();
          navigate('/sign-in', { replace: true });
        })();
      }}
    >
      {entityComponent()}
    </AppShell>
  );
};
