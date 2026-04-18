import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  dashboardApi,
  departmentManagersApi,
  employeesApi,
  invitationsApi,
  optionsApi,
  reportsApi,
  type DepartmentManagerPayload,
  type DepartmentManagerUpdatePayload,
  type EmployeePayload,
  type EmployeeUpdatePayload,
  type InvitationListQuery,
  type ListQuery,
} from '../api/services';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { DataTable } from '../components/dashboard/DataTable';
import { EntitySection } from '../components/dashboard/EntitySection';
import { StatsCard } from '../components/dashboard/StatsCard';
import type { FormFieldConfig, RowAction, TableColumn } from '../components/dashboard/types';
import type {
  CompanyDepartmentBreakdown,
  CompanyHeadSummary,
  DepartmentManagerProfile,
  DepartmentOption,
  EmployeeProfile,
  InvitationListItem,
  ReportRead,
} from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type FormValues = Record<string, string | boolean>;
type InvitableProfile = DepartmentManagerProfile | EmployeeProfile;
type UserLike = {
  full_name?: string;
  email?: string;
  is_active?: boolean;
} | null | undefined;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const activeField: FormFieldConfig = {
  name: 'is_active',
  label: 'Active',
  type: 'checkbox',
  hiddenOnCreate: true,
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

const validateEmail = (email: string): boolean => EMAIL_PATTERN.test(email.trim());

const validateInvitedForm = (values: FormValues): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!String(values.full_name ?? '').trim()) errors.full_name = 'Full name is required';
  if (!String(values.email ?? '').trim()) {
    errors.email = 'Email is required';
  } else if (!validateEmail(String(values.email))) {
    errors.email = 'Invalid email format';
  }
  return errors;
};

const renderInvitationBadge = (
  invitation: { status: string } | null,
  isActive: boolean,
): ReactNode => {
  const badge = (label: string, classes: string) => <span className={`mw-badge ${classes}`}>{label}</span>;

  if (isActive) return badge('Active', 'mw-badge-success');
  const status = invitation?.status;
  if (!status || status === 'pending') return badge('Pending', 'mw-badge-warning');
  if (status === 'used') return badge('Used', 'mw-badge-info');
  if (status === 'expired') return badge('Expired', 'mw-badge-danger');
  if (status === 'cancelled') return badge('Cancelled', 'mw-badge-muted');
  return badge(status, 'mw-badge-muted');
};

const getUserName = (user: UserLike): string => user?.full_name?.trim() || 'Unknown user';
const getUserEmail = (user: UserLike): string => user?.email?.trim() || '-';
const isUserActive = (user: UserLike): boolean => Boolean(user?.is_active);

export const CompanyHeadDashboardPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [activeSectionId, setActiveSectionId] = useState<string>('overview');
  const [summary, setSummary] = useState<CompanyHeadSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState<boolean>(true);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);

  const [sectionReloadKey, setSectionReloadKey] = useState(0);
  const [departmentSearchInput, setDepartmentSearchInput] = useState('');
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [reportArchive, setReportArchive] = useState<ReportRead[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportDepartmentFilter, setReportDepartmentFilter] = useState<string>('all');
  const [reportPdfDownloadingId, setReportPdfDownloadingId] = useState<number | null>(null);
  const summaryRunRef = useRef(0);
  const departmentsRunRef = useRef(0);

  const allowed = user?.role === 'company_head';

  useEffect(() => {
    if (user && user.role !== 'company_head') {
      navigate(getDashboardPathByRole(user.role), { replace: true });
    }
  }, [user, navigate]);

  const loadSummary = useCallback(async () => {
    const runId = ++summaryRunRef.current;
    setSummaryLoading(true);
    setSummaryError(null);
    if (import.meta.env.DEV) {
      console.info('[MindWell][CompanyHead] summary:load:start');
    }

    try {
      const response = await dashboardApi.companyHeadSummary();
      if (runId !== summaryRunRef.current) {
        return;
      }
      setSummary(response);
      if (import.meta.env.DEV) {
        console.info('[MindWell][CompanyHead] summary:load:success', {
          companyId: response.company_id,
          departmentCount: response.total_departments,
        });
      }
    } catch (error) {
      if (runId !== summaryRunRef.current) {
        return;
      }
      const message = getApiErrorMessage(error, 'Failed to load company dashboard summary');
      setSummaryError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (runId === summaryRunRef.current) {
        setSummaryLoading(false);
      }
    }
  }, []);

  const loadDepartments = useCallback(async () => {
    const runId = ++departmentsRunRef.current;
    setDepartmentsLoading(true);
    setDepartmentsError(null);
    if (import.meta.env.DEV) {
      console.info('[MindWell][CompanyHead] departments:load:start');
    }

    try {
      const response = await optionsApi.departments();
      if (runId !== departmentsRunRef.current) {
        return;
      }
      setDepartments(response);
      if (import.meta.env.DEV) {
        console.info('[MindWell][CompanyHead] departments:load:success', { count: response.length });
      }
    } catch (error) {
      if (runId !== departmentsRunRef.current) {
        return;
      }
      const message = getApiErrorMessage(error, 'Failed to load department options');
      setDepartmentsError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (runId === departmentsRunRef.current) {
        setDepartmentsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void Promise.all([loadSummary(), loadDepartments()]);
  }, [allowed, loadSummary, loadDepartments]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[MindWell][CompanyHead] state', {
      section: activeSectionId,
      summaryLoading,
      hasSummaryError: Boolean(summaryError),
      departmentsLoading,
      hasDepartmentsError: Boolean(departmentsError),
    });
  }, [activeSectionId, summaryLoading, summaryError, departmentsLoading, departmentsError]);

  const departmentNameMap = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );

  const departmentSelectOptions = useMemo(
    () =>
      departments.map((department) => ({
        value: String(department.id),
        label: `${department.name} (${department.code})`,
      })),
    [departments],
  );

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    setReportsError(null);
    try {
      const data = await reportsApi.list({
        page: 1,
        pageSize: 100,
        departmentId: reportDepartmentFilter === 'all' ? undefined : Number(reportDepartmentFilter),
      });
      setReportArchive(data.items);
    } catch (error) {
      setReportsError(getApiErrorMessage(error, 'Failed to load submitted reports'));
    } finally {
      setReportsLoading(false);
    }
  }, [reportDepartmentFilter]);

  useEffect(() => {
    if (!allowed || activeSectionId !== 'reports') {
      return;
    }
    void loadReports();
  }, [allowed, activeSectionId, loadReports]);

  const refreshAfterChange = useCallback(async () => {
    await Promise.all([loadSummary(), loadDepartments()]);
  }, [loadSummary, loadDepartments]);

  const bumpSectionReload = useCallback(() => {
    setSectionReloadKey((prev) => prev + 1);
  }, []);

  const handleInvitationResend = useCallback(
    async (invitationId: number) => {
      try {
        await invitationsApi.resend(invitationId);
        toast.success('Invitation resent successfully');
        await refreshAfterChange();
        bumpSectionReload();
      } catch (error) {
        const message = getApiErrorMessage(error, 'Failed to resend invitation');
        toast.error(message);
      }
    },
    [bumpSectionReload, refreshAfterChange],
  );

  const handleInvitationCancel = useCallback(
    async (invitationId: number) => {
      try {
        await invitationsApi.cancel(invitationId);
        toast.success('Invitation cancelled successfully');
        await refreshAfterChange();
        bumpSectionReload();
      } catch (error) {
        const message = getApiErrorMessage(error, 'Failed to cancel invitation');
        toast.error(message);
      }
    },
    [bumpSectionReload, refreshAfterChange],
  );

  const handleReportPdfDownload = useCallback(async (report: ReportRead) => {
    try {
      setReportPdfDownloadingId(report.id);
      const blob = await reportsApi.downloadPdf(report.id);
      const fileUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const submittedDate = new Date(report.submitted_at);
      const dateSegment = Number.isNaN(submittedDate.getTime())
        ? 'report'
        : submittedDate.toISOString().slice(0, 10);
      link.href = fileUrl;
      link.download = `mindwell-report-v${report.version}-${dateSegment}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(fileUrl);
      toast.success('Report PDF downloaded successfully');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to download report PDF'));
    } finally {
      setReportPdfDownloadingId(null);
    }
  }, []);

  const invitationRowActions = useCallback(
    <T extends InvitableProfile>(): RowAction<T>[] => [
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

  const invitationSectionActions: RowAction<InvitationListItem>[] = useMemo(
    () => [
      {
        key: 'resend',
        label: 'Resend',
        variant: 'success',
        onClick: (item) => {
          void handleInvitationResend(item.id);
        },
        hidden: (item) => item.status === 'used',
      },
      {
        key: 'cancel',
        label: 'Cancel',
        variant: 'danger',
        onClick: (item) => {
          void handleInvitationCancel(item.id);
        },
        hidden: (item) => item.status !== 'pending',
      },
    ],
    [handleInvitationCancel, handleInvitationResend],
  );

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'department-managers', label: 'Department Managers' },
    { id: 'employees', label: 'Employees' },
    { id: 'departments', label: 'Departments' },
    { id: 'reports', label: 'Reports' },
    { id: 'invitations', label: 'Invitations' },
  ];

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId('overview');
    }
  }, [activeSectionId, sections]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!allowed) return <Navigate to={getDashboardPathByRole(user.role)} replace />;

  const managerColumns: TableColumn<DepartmentManagerProfile>[] = [
    { key: 'name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    {
      key: 'department',
      title: 'Department',
      render: (item) => departmentNameMap.get(item.department_id) ?? item.department_id,
    },
    {
      key: 'onboarding',
      title: 'Onboarding',
      render: (item) => renderInvitationBadge(item.invitation, isUserActive(item.user)),
    },
    {
      key: 'created_at',
      title: 'Created',
      render: (item) => new Date(item.created_at).toLocaleDateString(),
    },
  ];

  const employeeColumns: TableColumn<EmployeeProfile>[] = [
    { key: 'name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    {
      key: 'department',
      title: 'Department',
      render: (item) => departmentNameMap.get(item.department_id) ?? item.department_id,
    },
    { key: 'employee_code', title: 'Employee Code', render: (item) => item.employee_code || '-' },
    { key: 'job_title', title: 'Job Title', render: (item) => item.job_title || '-' },
    {
      key: 'onboarding',
      title: 'Onboarding',
      render: (item) => renderInvitationBadge(item.invitation, isUserActive(item.user)),
    },
  ];

  const departmentBreakdownColumns: TableColumn<CompanyDepartmentBreakdown>[] = [
    { key: 'department_name', title: 'Department', render: (item) => item.department_name },
    { key: 'department_code', title: 'Code', render: (item) => item.department_code },
    { key: 'manager_count', title: 'Managers', render: (item) => item.department_manager_count },
    { key: 'employee_count', title: 'Employees', render: (item) => item.employee_count },
  ];

  const invitationColumns: TableColumn<InvitationListItem>[] = [
    { key: 'name', title: 'Name', render: (item) => item.full_name },
    { key: 'email', title: 'Email', render: (item) => item.email },
    {
      key: 'role',
      title: 'Role',
      render: (item) => (item.role === 'department_manager' ? 'Department Manager' : 'Employee'),
    },
    { key: 'department', title: 'Department', render: (item) => item.department_name ?? '-' },
    {
      key: 'status',
      title: 'Status',
      render: (item) => renderInvitationBadge({ status: item.status }, false),
    },
    {
      key: 'sent_at',
      title: 'Sent',
      render: (item) => (item.sent_at ? new Date(item.sent_at).toLocaleDateString() : '-'),
    },
    {
      key: 'expires_at',
      title: 'Expires',
      render: (item) => (item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '-'),
    },
  ];

  const reportColumns: TableColumn<ReportRead>[] = [
    { key: 'version', title: 'Version', render: (item) => <strong>v{item.version}</strong> },
    { key: 'department', title: 'Department', render: (item) => departmentNameMap.get(item.department_id) ?? `#${item.department_id}` },
    { key: 'flagged', title: 'Flagged', render: (item) => item.flagged_employee_count },
    { key: 'submitted_by', title: 'Submitted By', render: (item) => item.manager_name ?? '-' },
    { key: 'submitted_at', title: 'Submitted', render: (item) => new Date(item.submitted_at).toLocaleDateString() },
    { key: 'status', title: 'Status', render: (item) => <span className="mw-badge mw-badge-success">{item.status}</span> },
    {
      key: 'pdf',
      title: 'PDF',
      render: (item) => (
        <button
          type="button"
          className="mw-btn-ghost"
          style={{ padding: '4px 12px', fontSize: '13px' }}
          onClick={() => {
            void handleReportPdfDownload(item);
          }}
          disabled={reportPdfDownloadingId === item.id}
        >
          {reportPdfDownloadingId === item.id ? 'Preparing...' : 'Download'}
        </button>
      ),
    },
  ];

  const renderOverview = () => {
    if (summaryLoading) {
      return <div className="mw-card mw-loading-card">Loading company overview...</div>;
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
          <h3>Overview unavailable</h3>
          <p>No company summary data was returned.</p>
        </div>
      );
    }

    return (
      <section className="mw-entity-layout">
        <section className="mw-stat-grid">
          <StatsCard label="Departments" value={summary.total_departments} />
          <StatsCard label="Department Managers" value={summary.total_department_managers} />
          <StatsCard label="Employees" value={summary.total_employees} />
          <StatsCard label="Active Invitations" value={summary.active_invitations_count} />
          <StatsCard label="Completed Onboardings" value={summary.completed_onboardings_count} />
        </section>

        <div className="mw-panel-grid">
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Company Snapshot</p>
            <h3>{summary.company_name}</h3>
            <p>
              Your management scope is locked to this company. Invite department managers and employees, monitor
              onboarding health, and keep department operations aligned.
            </p>
            <div className="mw-info-panel-actions">
              <button type="button" className="mw-btn-primary" onClick={() => setActiveSectionId('employees')}>
                Invite Employee
              </button>
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => setActiveSectionId('department-managers')}
              >
                Invite Manager
              </button>
            </div>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Recent Invitations</p>
            <h3>Invitation Activity</h3>
            {summary.recent_invitations.length ? (
              <ul className="mw-simple-list">
                {summary.recent_invitations.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.full_name}</strong>
                      <span>{item.email}</span>
                    </div>
                    {renderInvitationBadge({ status: item.status }, false)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mw-helper-text">No invitations sent yet.</p>
            )}
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Recent Employees</p>
            <h3>Latest Added</h3>
            {summary.recent_employees.length ? (
              <ul className="mw-simple-list">
                {summary.recent_employees.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.full_name}</strong>
                      <span>{item.email}</span>
                    </div>
                    <span className="mw-helper-text">{new Date(item.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mw-helper-text">No employees onboarded yet.</p>
            )}
          </article>
        </div>
      </section>
    );
  };

  const filteredDepartmentBreakdown = useMemo(() => {
    if (!summary) return [];
    const term = departmentSearch.trim().toLowerCase();
    if (!term) return summary.department_breakdown;
    return summary.department_breakdown.filter(
      (item) => item.department_name.toLowerCase().includes(term) || item.department_code.toLowerCase().includes(term),
    );
  }, [summary, departmentSearch]);

  const renderDepartmentBreakdown = () => {
    if (summaryLoading) {
      return <div className="mw-card mw-loading-card">Loading department breakdown...</div>;
    }
    if (summaryError) {
      return (
        <div className="mw-card mw-empty-state">
          <h3>Department data unavailable</h3>
          <p>{summaryError}</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadSummary();
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Department View</p>
              <h2 className="mw-entity-title">Departments</h2>
              <p className="mw-entity-description">Department-level manager and employee distribution for your company.</p>
            </div>
          </div>

          <div className="mw-entity-controls">
            <label className="mw-field mw-entity-search">
              <span className="mw-field-label">Search departments</span>
              <input
                value={departmentSearchInput}
                onChange={(event) => setDepartmentSearchInput(event.target.value)}
                placeholder="Search by name or code"
                className="mw-input"
              />
            </label>
            <div className="mw-entity-control-actions">
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => {
                  setDepartmentSearch(departmentSearchInput);
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => {
                  setDepartmentSearchInput('');
                  setDepartmentSearch('');
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <DataTable
          columns={departmentBreakdownColumns}
          items={filteredDepartmentBreakdown}
          getRowId={(item) => item.department_id}
          loading={summaryLoading}
        />

        {!filteredDepartmentBreakdown.length ? (
          <div className="mw-card mw-empty-state">
            <h3>No departments found</h3>
            <p>Try a different search filter.</p>
          </div>
        ) : null}
      </section>
    );
  };

  const renderReports = () => {
    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Company Reports</p>
              <h2 className="mw-entity-title">Department Manager Submissions</h2>
              <p className="mw-entity-description">
                Review submitted reports from managers across your company and export polished PDF copies.
              </p>
            </div>
          </div>

          <div className="mw-entity-controls">
            <label className="mw-field mw-entity-search">
              <span className="mw-field-label">Department Filter</span>
              <select
                className="mw-input"
                value={reportDepartmentFilter}
                onChange={(event) => setReportDepartmentFilter(event.target.value)}
              >
                <option value="all">All Departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name} ({department.code})
                  </option>
                ))}
              </select>
            </label>
            <div className="mw-entity-control-actions">
              <button
                type="button"
                className="mw-btn-ghost"
                onClick={() => {
                  void loadReports();
                }}
                disabled={reportsLoading}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {reportsError ? (
          <div className="mw-card mw-empty-state">
            <h3>Reports unavailable</h3>
            <p>{reportsError}</p>
            <button
              type="button"
              className="mw-btn-primary mt-4"
              onClick={() => {
                void loadReports();
              }}
            >
              Retry reports load
            </button>
          </div>
        ) : (
          <DataTable
            columns={reportColumns}
            items={reportArchive}
            getRowId={(item) => item.id}
            loading={reportsLoading}
          />
        )}

        {!reportsLoading && !reportsError && !reportArchive.length ? (
          <div className="mw-card mw-empty-state">
            <h3>No reports submitted yet</h3>
            <p>Once department managers submit reports, they will appear here with PDF export options.</p>
          </div>
        ) : null}
      </section>
    );
  };

  const renderSection = () => {
    if (activeSectionId === 'overview') {
      return renderOverview();
    }

    if (!summary) {
      if (summaryLoading) {
        return <div className="mw-card mw-loading-card">Loading company context...</div>;
      }
      return (
        <div className="mw-card mw-empty-state">
          <h3>Company context unavailable</h3>
          <p>Retry loading the page to continue managing your company workspace.</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadSummary();
            }}
          >
            Retry company load
          </button>
        </div>
      );
    }

    if (departmentsLoading && activeSectionId !== 'invitations') {
      return <div className="mw-card mw-loading-card">Loading department options...</div>;
    }

    if (departmentsError && activeSectionId !== 'invitations') {
      return (
        <div className="mw-card mw-empty-state">
          <h3>Department options unavailable</h3>
          <p>{departmentsError}</p>
          <button
            type="button"
            className="mw-btn-primary mt-4"
            onClick={() => {
              void loadDepartments();
            }}
          >
            Retry options load
          </button>
        </div>
      );
    }

    if (activeSectionId === 'department-managers') {
      return (
        <EntitySection<DepartmentManagerProfile>
          title="Department Managers"
          description={`Invite and manage department managers inside ${summary.company_name}.`}
          createButtonLabel="Invite Department Manager"
          columns={managerColumns}
          fields={[
            { name: 'full_name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            {
              name: 'department_id',
              label: 'Department',
              type: 'select',
              required: true,
              options: departmentSelectOptions,
              placeholder: 'Select department',
            },
            activeField,
          ]}
          filters={[{ key: 'departmentId', label: 'Department Filter', options: departmentSelectOptions }]}
          rowActions={invitationRowActions<DepartmentManagerProfile>()}
          reloadKey={sectionReloadKey}
          fetchItems={(query: ListQuery) =>
            departmentManagersApi.list({
              ...query,
              companyId: summary.company_id,
            })
          }
          createItem={(payload) => departmentManagersApi.create(payload as DepartmentManagerPayload)}
          updateItem={(id, payload) => departmentManagersApi.update(id, payload as DepartmentManagerUpdatePayload)}
          deleteItem={(id) => departmentManagersApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            department_id: item ? String(item.department_id) : '',
            is_active: item?.user?.is_active ?? false,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: summary.company_id,
            department_id: Number(values.department_id),
          })}
          toUpdatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: summary.company_id,
            department_id: Number(values.department_id),
            is_active: Boolean(values.is_active),
          })}
          validate={(values) => {
            const errors = validateInvitedForm(values);
            if (!String(values.department_id ?? '').trim()) {
              errors.department_id = 'Department is required';
            }
            return errors;
          }}
          createSuccessMessage="Invitation sent successfully"
          onAfterChange={refreshAfterChange}
        />
      );
    }

    if (activeSectionId === 'employees') {
      return (
        <EntitySection<EmployeeProfile>
          title="Employees"
          description={`Invite and manage employee accounts inside ${summary.company_name}.`}
          createButtonLabel="Invite Employee"
          columns={employeeColumns}
          fields={[
            { name: 'full_name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            {
              name: 'department_id',
              label: 'Department',
              type: 'select',
              required: true,
              options: departmentSelectOptions,
              placeholder: 'Select department',
            },
            { name: 'employee_code', label: 'Employee Code (Optional)', type: 'text' },
            { name: 'job_title', label: 'Job Title (Optional)', type: 'text' },
            activeField,
          ]}
          filters={[{ key: 'departmentId', label: 'Department Filter', options: departmentSelectOptions }]}
          rowActions={invitationRowActions<EmployeeProfile>()}
          reloadKey={sectionReloadKey}
          fetchItems={(query: ListQuery) =>
            employeesApi.list({
              ...query,
              companyId: summary.company_id,
            })
          }
          createItem={(payload) => employeesApi.create(payload as EmployeePayload)}
          updateItem={(id, payload) => employeesApi.update(id, payload as EmployeeUpdatePayload)}
          deleteItem={(id) => employeesApi.remove(id)}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => getUserEmail(item.user)}
          toFormValues={(item) => ({
            full_name: item?.user?.full_name ?? '',
            email: item?.user?.email ?? '',
            department_id: item ? String(item.department_id) : '',
            employee_code: item?.employee_code ?? '',
            job_title: item?.job_title ?? '',
            is_active: item?.user?.is_active ?? false,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: summary.company_id,
            department_id: Number(values.department_id),
            employee_code: String(values.employee_code || '').trim() || null,
            job_title: String(values.job_title || '').trim() || null,
          })}
          toUpdatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: summary.company_id,
            department_id: Number(values.department_id),
            employee_code: String(values.employee_code || '').trim() || null,
            job_title: String(values.job_title || '').trim() || null,
            is_active: Boolean(values.is_active),
          })}
          validate={(values) => {
            const errors = validateInvitedForm(values);
            if (!String(values.department_id ?? '').trim()) {
              errors.department_id = 'Department is required';
            }
            return errors;
          }}
          createSuccessMessage="Invitation sent successfully"
          onAfterChange={refreshAfterChange}
        />
      );
    }

    if (activeSectionId === 'departments') {
      return renderDepartmentBreakdown();
    }

    if (activeSectionId === 'reports') {
      return renderReports();
    }

    if (activeSectionId === 'invitations') {
      return (
        <EntitySection<InvitationListItem>
          title="Invitations"
          description={`Track invitation delivery and onboarding statuses for ${summary.company_name}.`}
          showCreateButton={false}
          enableEdit={false}
          enableDelete={false}
          columns={invitationColumns}
          fields={[]}
          filters={[
            {
              key: 'role',
              label: 'Role Filter',
              options: [
                { value: 'department_manager', label: 'Department Manager' },
                { value: 'employee', label: 'Employee' },
              ],
            },
            {
              key: 'status',
              label: 'Status Filter',
              options: [
                { value: 'pending', label: 'Pending' },
                { value: 'used', label: 'Used' },
                { value: 'expired', label: 'Expired' },
                { value: 'cancelled', label: 'Cancelled' },
              ],
            },
            { key: 'departmentId', label: 'Department Filter', options: departmentSelectOptions },
          ]}
          rowActions={invitationSectionActions}
          reloadKey={sectionReloadKey}
          fetchItems={(query) =>
            invitationsApi.list({
              ...(query as InvitationListQuery),
              companyId: summary.company_id,
            })
          }
          createItem={async () => ({})}
          updateItem={async () => ({})}
          deleteItem={async () => {}}
          getItemId={(item) => item.id}
          getDeleteLabel={(item) => item.email}
          toFormValues={() => ({})}
          toCreatePayload={() => ({})}
          toUpdatePayload={() => ({})}
          onAfterChange={refreshAfterChange}
        />
      );
    }

    return <div className="mw-card mw-loading-card">Select a section from the sidebar.</div>;
  };

  return (
    <AppShell
      title="Company Head Dashboard"
      subtitle="Manage departments, invitations, and employee onboarding only within your company scope."
      roleLabel="Company Head"
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
      {renderSection()}
    </AppShell>
  );
};
