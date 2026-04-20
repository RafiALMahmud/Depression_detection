import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  dashboardApi,
  employeesApi,
  invitationsApi,
  reportsApi,
  type EmployeePayload,
  type EmployeeUpdatePayload,
  type InvitationListQuery,
  type ReportSubmitPayload,
} from '../api/services';
import { DataTable } from '../components/dashboard/DataTable';
import type { EmployeeComplianceEntry, FlaggedEmployeeEntry, ReportPreview, ReportRead } from '../types/domain';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { EntitySection } from '../components/dashboard/EntitySection';
import { StatsCard } from '../components/dashboard/StatsCard';
import type { FormFieldConfig, RowAction, TableColumn } from '../components/dashboard/types';
import type {
  DepartmentComparisonItem,
  DepartmentManagerAnalytics,
  DepartmentManagerSummary,
  EmployeeProfile,
  InvitationListItem,
} from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type FormValues = Record<string, string | boolean>;
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

const validateEmployeeForm = (values: FormValues): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (!String(values.full_name ?? '').trim()) errors.full_name = 'Full name is required';
  if (!String(values.email ?? '').trim()) {
    errors.email = 'Email is required';
  } else if (!validateEmail(String(values.email))) {
    errors.email = 'Invalid email format';
  }
  return errors;
};

const renderInvitationBadge = (status: string, isActive: boolean): ReactNode => {
  const badge = (label: string, classes: string) => <span className={`mw-badge ${classes}`}>{label}</span>;

  if (isActive) return badge('Active', 'mw-badge-success');
  if (!status || status === 'pending') return badge('Pending', 'mw-badge-warning');
  if (status === 'used') return badge('Used', 'mw-badge-info');
  if (status === 'expired') return badge('Expired', 'mw-badge-danger');
  if (status === 'cancelled') return badge('Cancelled', 'mw-badge-muted');
  return badge(status, 'mw-badge-muted');
};

const getUserName = (user: UserLike): string => user?.full_name?.trim() || 'Unknown user';
const getUserEmail = (user: UserLike): string => user?.email?.trim() || '-';
const isUserActive = (user: UserLike): boolean => Boolean(user?.is_active);

const HEALTH_INDICATOR_STYLE: Record<'green' | 'amber' | 'red', { badge: string; color: string }> = {
  green: { badge: 'mw-badge-success', color: '#2d7a47' },
  amber: { badge: 'mw-badge-warning', color: '#d97706' },
  red: { badge: 'mw-badge-danger', color: '#dc2626' },
};

const TIER_COLORS: Record<string, string> = {
  low: '#3a8f55',
  moderate: '#d97706',
  high: '#ef6c00',
  severe: '#dc2626',
};

const formatPercentage = (value: number): string => `${value.toFixed(1)}%`;

const formatWeekLabel = (isoDate: string): string => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export const DepartmentManagerDashboardPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [activeSectionId, setActiveSectionId] = useState<string>('overview');
  const [summary, setSummary] = useState<DepartmentManagerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [sectionReloadKey, setSectionReloadKey] = useState(0);
  const [complianceData, setComplianceData] = useState<EmployeeComplianceEntry[] | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<DepartmentManagerAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const [reportPreview, setReportPreview] = useState<ReportPreview | null>(null);
  const [reportPreviewLoading, setReportPreviewLoading] = useState(false);
  const [reportPreviewError, setReportPreviewError] = useState<string | null>(null);
  const [reportAssessment, setReportAssessment] = useState('');
  const [reportBehavior, setReportBehavior] = useState('');
  const [reportInterventions, setReportInterventions] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportArchive, setReportArchive] = useState<ReportRead[]>([]);
  const [reportArchiveLoading, setReportArchiveLoading] = useState(false);
  const [reportView, setReportView] = useState<'builder' | 'archive'>('builder');
  const [selectedReport, setSelectedReport] = useState<ReportRead | null>(null);
  const [reportPdfDownloadingId, setReportPdfDownloadingId] = useState<number | null>(null);

  const summaryRunRef = useRef(0);
  const analyticsRunRef = useRef(0);

  const allowed = user?.role === 'department_manager';

  useEffect(() => {
    if (user && user.role !== 'department_manager') {
      navigate(getDashboardPathByRole(user.role), { replace: true });
    }
  }, [user, navigate]);

  const loadSummary = useCallback(async () => {
    const runId = ++summaryRunRef.current;
    setSummaryLoading(true);
    setSummaryError(null);
    if (import.meta.env.DEV) {
      console.info('[MindWell][DepartmentManager] summary:load:start');
    }

    try {
      const response = await dashboardApi.departmentManagerSummary();
      if (runId !== summaryRunRef.current) {
        return;
      }
      setSummary(response);
      if (import.meta.env.DEV) {
        console.info('[MindWell][DepartmentManager] summary:load:success', {
          departmentId: response.department_id,
          employeeCount: response.total_employees,
        });
      }
    } catch (error) {
      if (runId !== summaryRunRef.current) {
        return;
      }
      const message = getApiErrorMessage(error, 'Failed to load department dashboard summary');
      setSummaryError(message);
      toast.error(message);
      console.error(error);
    } finally {
      if (runId === summaryRunRef.current) {
        setSummaryLoading(false);
      }
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    const runId = ++analyticsRunRef.current;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    if (import.meta.env.DEV) {
      console.info('[MindWell][DepartmentManager] analytics:load:start');
    }

    try {
      const response = await dashboardApi.departmentManagerAnalytics();
      if (runId !== analyticsRunRef.current) return;
      setAnalytics(response);
      if (import.meta.env.DEV) {
        console.info('[MindWell][DepartmentManager] analytics:load:success', {
          entries: response.weekly_averages.length,
          comparisonDepartments: response.cross_department_comparison.length,
        });
      }
    } catch (error) {
      if (runId !== analyticsRunRef.current) return;
      const message = getApiErrorMessage(error, 'Failed to load anonymized department analytics.');
      setAnalyticsError(message);
      toast.error(message);
    } finally {
      if (runId === analyticsRunRef.current) {
        setAnalyticsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadSummary();
  }, [allowed, loadSummary]);

  useEffect(() => {
    if (!allowed) return;
    if (!['overview', 'detection-analytics', 'facial-scores', 'questionnaire-scores', 'average-trends'].includes(activeSectionId)) {
      return;
    }
    if (!analytics && !analyticsLoading) {
      void loadAnalytics();
    }
  }, [activeSectionId, allowed, analytics, analyticsLoading, loadAnalytics]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[MindWell][DepartmentManager] state', {
      section: activeSectionId,
      summaryLoading,
      hasSummaryError: Boolean(summaryError),
      analyticsLoading,
      hasAnalyticsError: Boolean(analyticsError),
    });
  }, [activeSectionId, summaryLoading, summaryError, analyticsLoading, analyticsError]);

  const refreshAfterChange = useCallback(async () => {
    await Promise.all([loadSummary(), loadAnalytics()]);
  }, [loadSummary, loadAnalytics]);

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

  const invitationRowActions = useMemo<RowAction<InvitationListItem>[]>(
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

  const employeeRowActions = useMemo<RowAction<EmployeeProfile>[]>(
    () => [
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

  const loadCompliance = useCallback(async () => {
    setComplianceLoading(true);
    setComplianceError(null);
    try {
      const data = await employeesApi.compliance();
      setComplianceData(data);
    } catch (error) {
      setComplianceError(getApiErrorMessage(error, 'Failed to load compliance data'));
    } finally {
      setComplianceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSectionId === 'compliance' && !complianceData && !complianceLoading) {
      void loadCompliance();
    }
  }, [activeSectionId, complianceData, complianceLoading, loadCompliance]);

  const loadReportPreview = useCallback(async () => {
    setReportPreviewLoading(true);
    setReportPreviewError(null);
    try {
      const data = await reportsApi.preview();
      setReportPreview(data);
    } catch (error) {
      setReportPreviewError(getApiErrorMessage(error, 'Failed to load report preview'));
    } finally {
      setReportPreviewLoading(false);
    }
  }, []);

  const loadReportArchive = useCallback(async () => {
    setReportArchiveLoading(true);
    try {
      const data = await reportsApi.list({ page: 1, pageSize: 50 });
      setReportArchive(data.items);
    } catch {
      // silently fail — archive is supplementary
    } finally {
      setReportArchiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSectionId === 'reports' && !reportPreview && !reportPreviewLoading) {
      void loadReportPreview();
      void loadReportArchive();
    }
  }, [activeSectionId, reportPreview, reportPreviewLoading, loadReportPreview, loadReportArchive]);

  const handleSubmitReport = useCallback(async () => {
    if (!reportAssessment.trim()) {
      toast.error('Assessment is required before submitting.');
      return;
    }
    setReportSubmitting(true);
    try {
      const payload: ReportSubmitPayload = {
        assessment: reportAssessment.trim(),
        behavioral_patterns: reportBehavior.trim(),
        recommended_interventions: reportInterventions.trim(),
      };
      await reportsApi.submit(payload);
      toast.success('Report submitted successfully.');
      setReportAssessment('');
      setReportBehavior('');
      setReportInterventions('');
      await loadReportPreview();
      await loadReportArchive();
      setReportView('archive');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to submit report'));
    } finally {
      setReportSubmitting(false);
    }
  }, [reportAssessment, reportBehavior, reportInterventions, loadReportPreview, loadReportArchive]);

  const tierBadge = (tier: string) => {
    if (tier === 'severe') return <span className="mw-badge mw-badge-danger">Severe</span>;
    if (tier === 'high') return <span className="mw-badge mw-badge-warning">High</span>;
    return <span className="mw-badge mw-badge-muted">{tier}</span>;
  };

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
      toast.success('PDF downloaded successfully');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to download report PDF'));
    } finally {
      setReportPdfDownloadingId(null);
    }
  }, []);

  const renderReportsSection = () => {
    const flaggedColumns = [
      { key: 'id', title: 'Anonymized ID', render: (e: FlaggedEmployeeEntry) => e.anonymized_id },
      { key: 'tier', title: 'Risk Tier', render: (e: FlaggedEmployeeEntry) => tierBadge(e.threshold_tier) },
      { key: 'composite', title: 'Composite Score', render: (e: FlaggedEmployeeEntry) => e.composite_score?.toFixed(1) ?? '-' },
      { key: 'facial', title: 'Facial Score', render: (e: FlaggedEmployeeEntry) => e.facial_score?.toFixed(1) ?? '-' },
      { key: 'questionnaire', title: 'Q. Score', render: (e: FlaggedEmployeeEntry) => e.questionnaire_score?.toFixed(1) ?? '-' },
      { key: 'sessions', title: 'Sessions', render: (e: FlaggedEmployeeEntry) => e.sessions_count },
    ] satisfies TableColumn<FlaggedEmployeeEntry>[];

    const archiveColumns = [
      { key: 'version', title: 'Version', render: (r: ReportRead) => <strong>v{r.version}</strong> },
      { key: 'flagged', title: 'Flagged', render: (r: ReportRead) => r.flagged_employee_count },
      { key: 'submitted_by', title: 'Submitted By', render: (r: ReportRead) => r.manager_name ?? '-' },
      { key: 'date', title: 'Submitted', render: (r: ReportRead) => new Date(r.submitted_at).toLocaleDateString() },
      { key: 'status', title: 'Status', render: (r: ReportRead) => <span className="mw-badge mw-badge-success">{r.status}</span> },
      {
        key: 'view',
        title: '',
        render: (r: ReportRead) => (
          <button
            type="button"
            className="mw-btn-ghost"
            style={{ padding: '4px 12px', fontSize: '13px' }}
            onClick={() => setSelectedReport(selectedReport?.id === r.id ? null : r)}
          >
            {selectedReport?.id === r.id ? 'Close' : 'View'}
          </button>
        ),
      },
      {
        key: 'pdf',
        title: 'PDF',
        render: (r: ReportRead) => (
          <button
            type="button"
            className="mw-btn-ghost"
            style={{ padding: '4px 12px', fontSize: '13px' }}
            onClick={() => {
              void handleReportPdfDownload(r);
            }}
            disabled={reportPdfDownloadingId === r.id}
          >
            {reportPdfDownloadingId === r.id ? 'Preparing...' : 'Download'}
          </button>
        ),
      },
    ] satisfies TableColumn<ReportRead>[];

    const selectedFlaggedColumns = [
      { key: 'id', title: 'Anonymized ID', render: (e: FlaggedEmployeeEntry) => e.anonymized_id },
      { key: 'tier', title: 'Risk Tier', render: (e: FlaggedEmployeeEntry) => tierBadge(e.threshold_tier) },
      { key: 'composite', title: 'Composite', render: (e: FlaggedEmployeeEntry) => e.composite_score?.toFixed(1) ?? '-' },
      { key: 'sessions', title: 'Sessions', render: (e: FlaggedEmployeeEntry) => e.sessions_count },
    ] satisfies TableColumn<FlaggedEmployeeEntry>[];

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Department Manager</p>
              <h2 className="mw-entity-title">Depression Status Report</h2>
              <p className="mw-entity-description">
                Auto-populated with High / Severe flagged employees. Add your written assessment and submit for audit.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button
                type="button"
                className={reportView === 'builder' ? 'mw-btn-primary' : 'mw-btn-ghost'}
                onClick={() => setReportView('builder')}
              >
                Report Builder
              </button>
              <button
                type="button"
                className={reportView === 'archive' ? 'mw-btn-primary' : 'mw-btn-ghost'}
                onClick={() => { setReportView('archive'); setSelectedReport(null); void loadReportArchive(); }}
              >
                Archive
              </button>
            </div>
          </div>
        </div>

        {/* ── BUILDER ── */}
        {reportView === 'builder' && (
          <>
            {reportPreviewLoading && (
              <div className="mw-card mw-loading-card">Loading department data…</div>
            )}
            {reportPreviewError && !reportPreviewLoading && (
              <div className="mw-card mw-empty-state">
                <h3>Could not load report data</h3>
                <p>{reportPreviewError}</p>
                <button
                  type="button"
                  className="mw-btn-primary"
                  style={{ marginTop: '16px' }}
                  onClick={() => { void loadReportPreview(); }}
                >
                  Retry
                </button>
              </div>
            )}
            {reportPreview && !reportPreviewLoading && (
              <>
                <section className="mw-stat-grid">
                  <StatsCard label="Next Version" value={reportPreview.next_version} />
                  <StatsCard label="Total Employees" value={reportPreview.department_summary.total_employees} />
                  <StatsCard label="High / Severe Flagged" value={reportPreview.department_summary.flagged_count} />
                  <StatsCard label="Compliant" value={reportPreview.department_summary.compliant_count} />
                  <StatsCard
                    label="Avg Composite Score"
                    value={reportPreview.department_summary.average_composite_score ?? 0}
                  />
                </section>

                <article className="mw-card">
                  <p className="mw-entity-kicker">Auto-populated · Anonymized</p>
                  <h3>Flagged Employees</h3>
                  <p className="mw-entity-description" style={{ marginBottom: '16px' }}>
                    Employee identities are hidden. Only risk tier and scores are included.
                  </p>
                  <DataTable<FlaggedEmployeeEntry>
                    columns={flaggedColumns}
                    items={reportPreview.flagged_employees}
                    getRowId={(e) => e.anonymized_id}
                    emptyMessage="No High or Severe flagged employees this period."
                  />
                </article>

                <article className="mw-card mw-info-panel">
                  <p className="mw-entity-kicker">Manager Input · Required</p>
                  <h3>Written Assessment</h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
                    <div>
                      <label className="mw-field-label">
                        Assessment&nbsp;<span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <textarea
                        className="mw-input mw-textarea"
                        rows={5}
                        placeholder="Describe the overall mental wellness status of the department this period…"
                        value={reportAssessment}
                        onChange={(e) => setReportAssessment(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mw-field-label">Observed Behavioural Patterns</label>
                      <textarea
                        className="mw-input mw-textarea"
                        rows={4}
                        placeholder="Describe any notable behavioural changes or patterns observed among employees…"
                        value={reportBehavior}
                        onChange={(e) => setReportBehavior(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mw-field-label">Recommended Interventions</label>
                      <textarea
                        className="mw-input mw-textarea"
                        rows={4}
                        placeholder="List recommended actions, support resources, or follow-up interventions…"
                        value={reportInterventions}
                        onChange={(e) => setReportInterventions(e.target.value)}
                      />
                    </div>

                    <div className="mw-info-panel-actions">
                      <button
                        type="button"
                        className="mw-btn-primary"
                        onClick={() => { void handleSubmitReport(); }}
                        disabled={reportSubmitting || !reportAssessment.trim()}
                      >
                        {reportSubmitting ? 'Submitting…' : 'Submit Report'}
                      </button>
                      <button
                        type="button"
                        className="mw-btn-ghost"
                        onClick={() => { void loadReportPreview(); }}
                        disabled={reportPreviewLoading}
                      >
                        Refresh Data
                      </button>
                    </div>
                  </div>
                </article>
              </>
            )}
          </>
        )}

        {/* ── ARCHIVE ── */}
        {reportView === 'archive' && (
          <>
            <article className="mw-card">
              <p className="mw-entity-kicker">Submitted Reports</p>
              <h3>Report Archive</h3>
              <p className="mw-entity-description" style={{ marginBottom: '16px' }}>
                All submitted reports are timestamped and versioned for audit and compliance purposes.
              </p>
              {reportArchiveLoading ? (
                <div className="mw-loading-card">Loading archive…</div>
              ) : (
                <DataTable<ReportRead>
                  columns={archiveColumns}
                  items={reportArchive}
                  getRowId={(r) => r.id}
                  emptyMessage="No reports submitted yet. Use the Report Builder tab to create one."
                />
              )}
            </article>

            {selectedReport && (
              <article className="mw-card mw-info-panel">
                <div className="mw-entity-header-row" style={{ marginBottom: '16px' }}>
                  <div>
                    <p className="mw-entity-kicker">Report Detail · v{selectedReport.version}</p>
                    <h3>
                      Submitted {new Date(selectedReport.submitted_at).toLocaleDateString()} by{' '}
                      {selectedReport.manager_name ?? 'Unknown'}
                    </h3>
                  </div>
                  <span className="mw-badge mw-badge-success">{selectedReport.status}</span>
                </div>

                {selectedReport.department_summary && (
                  <section className="mw-stat-grid" style={{ marginBottom: '20px' }}>
                    <StatsCard label="Total Employees" value={selectedReport.department_summary.total_employees} />
                    <StatsCard label="Flagged" value={selectedReport.flagged_employee_count} />
                    <StatsCard label="Compliant" value={selectedReport.department_summary.compliant_count} />
                    <StatsCard
                      label="Avg Composite Score"
                      value={selectedReport.department_summary.average_composite_score ?? 0}
                    />
                  </section>
                )}

                {selectedReport.flagged_employees_data && selectedReport.flagged_employees_data.length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <p className="mw-field-label" style={{ marginBottom: '10px' }}>Flagged Employees (at time of submission)</p>
                    <DataTable<FlaggedEmployeeEntry>
                      columns={selectedFlaggedColumns}
                      items={selectedReport.flagged_employees_data}
                      getRowId={(e) => e.anonymized_id}
                      emptyMessage="No flagged employees were recorded."
                    />
                  </div>
                )}

                {selectedReport.assessment && (
                  <div style={{ marginBottom: '16px' }}>
                    <p className="mw-field-label">Assessment</p>
                    <p style={{ color: 'var(--text)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                      {selectedReport.assessment}
                    </p>
                  </div>
                )}
                {selectedReport.behavioral_patterns && (
                  <div style={{ marginBottom: '16px' }}>
                    <p className="mw-field-label">Observed Behavioural Patterns</p>
                    <p style={{ color: 'var(--text)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                      {selectedReport.behavioral_patterns}
                    </p>
                  </div>
                )}
                {selectedReport.recommended_interventions && (
                  <div>
                    <p className="mw-field-label">Recommended Interventions</p>
                    <p style={{ color: 'var(--text)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                      {selectedReport.recommended_interventions}
                    </p>
                  </div>
                )}
              </article>
            )}
          </>
        )}
      </section>
    );
  };

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'employees', label: 'Employees' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'reports', label: 'Reports' },
    { id: 'detection-analytics', label: 'Detection Analytics' },
    { id: 'facial-scores', label: 'Facial Scores' },
    { id: 'questionnaire-scores', label: 'Questionnaire Scores' },
    { id: 'average-trends', label: 'Average Trends' },
    { id: 'invitations', label: 'Invitations' },
  ];

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId('overview');
    }
  }, [activeSectionId, sections]);

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!allowed) return <Navigate to={getDashboardPathByRole(user.role)} replace />;

  const employeeColumns: TableColumn<EmployeeProfile>[] = [
    { key: 'name', title: 'Name', render: (item) => getUserName(item.user) },
    { key: 'email', title: 'Email', render: (item) => getUserEmail(item.user) },
    { key: 'employee_code', title: 'Employee Code', render: (item) => item.employee_code || '-' },
    { key: 'job_title', title: 'Job Title', render: (item) => item.job_title || '-' },
    {
      key: 'onboarding',
      title: 'Onboarding',
      render: (item) => renderInvitationBadge(item.invitation?.status ?? 'pending', isUserActive(item.user)),
    },
    {
      key: 'created_at',
      title: 'Created',
      render: (item) => new Date(item.created_at).toLocaleDateString(),
    },
  ];

  const invitationColumns: TableColumn<InvitationListItem>[] = [
    { key: 'name', title: 'Name', render: (item) => item.full_name },
    { key: 'email', title: 'Email', render: (item) => item.email },
    {
      key: 'status',
      title: 'Status',
      render: (item) => renderInvitationBadge(item.status, false),
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

  const renderOverview = () => {
    if (summaryLoading) {
      return <div className="mw-card mw-loading-card">Loading department overview...</div>;
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
          <p>No department summary data was returned.</p>
        </div>
      );
    }

    return (
      <section className="mw-entity-layout">
        <section className="mw-stat-grid">
          <StatsCard label="Employees" value={summary.total_employees} />
          <StatsCard label="Active Invitations" value={summary.active_invitations_count} />
          <StatsCard label="Completed Onboardings" value={summary.completed_onboardings_count} />
          <StatsCard label="Scanned Employees" value={summary.scanned_employees_count_placeholder} />
          <StatsCard label="Average Wellness Score" value={summary.average_wellness_score_placeholder ?? 0} />
        </section>

        <div className="mw-panel-grid">
          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Department Scope</p>
            <h3>{summary.department_name}</h3>
            <p>
              Company: {summary.company_name}. Invite and manage employees only inside your assigned department.
              Cross-department actions are blocked for data safety.
            </p>
            <div className="mw-info-panel-actions">
              <button type="button" className="mw-btn-primary" onClick={() => setActiveSectionId('employees')}>
                Invite Employee
              </button>
              <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('invitations')}>
                Review Invitations
              </button>
            </div>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Anonymized Analytics</p>
            <h3>Department Pulse Is Now Live</h3>
            <p>
              View threshold distribution, week-over-week trend lines, and anonymized cross-department benchmarking
              from the analytics sections in the sidebar.
            </p>
            <div className="mw-info-panel-actions">
              <button type="button" className="mw-btn-ghost" onClick={() => setActiveSectionId('detection-analytics')}>
                Open Analytics
              </button>
            </div>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Recent Invitations</p>
            <h3>Latest Activity</h3>
            {summary.recent_invitations.length ? (
              <ul className="mw-simple-list">
                {summary.recent_invitations.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.full_name}</strong>
                      <span>{item.email}</span>
                    </div>
                    {renderInvitationBadge(item.status, false)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mw-helper-text">No invitations sent yet.</p>
            )}
          </article>
        </div>
      </section>
    );
  };

  const renderComplianceSection = () => {
    const badgeClass = (status: string) => {
      if (status === 'compliant') return 'mw-badge-success';
      if (status === 'non_compliant') return 'mw-badge-danger';
      return 'mw-badge-warning';
    };
    const badgeLabel = (status: string) => {
      if (status === 'compliant') return 'Compliant';
      if (status === 'non_compliant') return 'Non-Compliant';
      return 'Pending';
    };

    const nonCompliantCount = complianceData?.filter((e) => e.compliance_status === 'non_compliant').length ?? 0;
    const compliantCount = complianceData?.filter((e) => e.compliance_status === 'compliant').length ?? 0;

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Weekly Check-In</p>
              <h2 className="mw-entity-title">Employee Compliance</h2>
              <p className="mw-entity-description">
                Employees must complete 2 check-in sessions per week. Non-Compliant means they missed both sessions last week.
              </p>
            </div>
            {nonCompliantCount > 0 && (
              <span className="mw-badge mw-badge-danger">{nonCompliantCount} Non-Compliant</span>
            )}
          </div>
        </div>

        {complianceLoading && (
          <div className="mw-card mw-loading-card">Loading compliance data...</div>
        )}
        {complianceError && !complianceLoading && (
          <div className="mw-card mw-empty-state">
            <h3>Could not load compliance</h3>
            <p>{complianceError}</p>
            <button type="button" className="mw-btn-primary mt-4" onClick={() => { void loadCompliance(); }}>
              Retry
            </button>
          </div>
        )}
        {complianceData && !complianceLoading && (
          <>
            <section className="mw-stat-grid">
              <StatsCard label="Total Employees" value={complianceData.length} />
              <StatsCard label="Compliant" value={compliantCount} />
              <StatsCard label="Non-Compliant" value={nonCompliantCount} />
              <StatsCard label="Pending" value={complianceData.length - compliantCount - nonCompliantCount} />
            </section>

            <article className="mw-card">
              <DataTable<EmployeeComplianceEntry>
                columns={[
                  { key: 'name', title: 'Name', render: (e) => e.full_name },
                  { key: 'email', title: 'Email', render: (e) => e.email },
                  {
                    key: 'sessions',
                    title: 'Sessions This Week',
                    render: (e) => `${e.sessions_this_week} / 2`,
                  },
                  {
                    key: 'status',
                    title: 'Status',
                    render: (e) => (
                      <span className={`mw-badge ${badgeClass(e.compliance_status)}`}>
                        {badgeLabel(e.compliance_status)}
                      </span>
                    ),
                  },
                ] satisfies TableColumn<EmployeeComplianceEntry>[]}
                items={complianceData}
                getRowId={(e) => e.employee_id}
                emptyMessage="No employees in this department yet."
              />
              <div className="mw-info-panel-actions" style={{ marginTop: '16px' }}>
                <button type="button" className="mw-btn-ghost" onClick={() => { void loadCompliance(); }}>
                  Refresh
                </button>
              </div>
            </article>
          </>
        )}
      </section>
    );
  };

  const renderAnalyticsGuard = (title: string, description: string): ReactNode | null => {
    if (analyticsLoading) {
      return (
        <section className="mw-entity-layout">
          <div className="mw-card mw-entity-header">
            <div className="mw-entity-header-row">
              <div>
                <p className="mw-entity-kicker">Anonymized Department Analytics</p>
                <h2 className="mw-entity-title">{title}</h2>
                <p className="mw-entity-description">{description}</p>
              </div>
            </div>
          </div>
          <div className="mw-card mw-loading-card">Loading anonymized analytics...</div>
        </section>
      );
    }
    if (analyticsError) {
      return (
        <section className="mw-entity-layout">
          <div className="mw-card mw-empty-state">
            <h3>Analytics unavailable</h3>
            <p>{analyticsError}</p>
            <button type="button" className="mw-btn-primary mt-4" onClick={() => { void loadAnalytics(); }}>
              Retry analytics load
            </button>
          </div>
        </section>
      );
    }
    if (!analytics) {
      return (
        <section className="mw-entity-layout">
          <div className="mw-card mw-empty-state">
            <h3>Analytics unavailable</h3>
            <p>Department analytics have not loaded yet.</p>
            <button type="button" className="mw-btn-primary mt-4" onClick={() => { void loadAnalytics(); }}>
              Load analytics
            </button>
          </div>
        </section>
      );
    }
    return null;
  };

  const renderDetectionAnalyticsSection = () => {
    const guard = renderAnalyticsGuard(
      'Detection Analytics',
      'Anonymized, department-level threshold distribution and health indicator based on latest completed sessions.',
    );
    if (guard) return guard;

    const currentAnalytics = analytics as DepartmentManagerAnalytics;
    const healthStyle = HEALTH_INDICATOR_STYLE[currentAnalytics.health_indicator.color];
    const distributionData = currentAnalytics.threshold_distribution.map((item) => ({
      tier: item.tier.charAt(0).toUpperCase() + item.tier.slice(1),
      percentage: Number(item.percentage.toFixed(2)),
      count: item.count,
      color: TIER_COLORS[item.tier] ?? '#64748b',
    }));

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Anonymized Department Analytics</p>
              <h2 className="mw-entity-title">Detection Analytics</h2>
              <p className="mw-entity-description">
                Percent of employees in each threshold tier (Low / Moderate / High / Severe) and an overall health indicator.
              </p>
            </div>
            <span className={`mw-badge ${healthStyle.badge}`}>{currentAnalytics.health_indicator.label}</span>
          </div>
        </div>

        <section className="mw-stat-grid">
          <StatsCard label="Total Employees" value={currentAnalytics.total_employees} />
          <StatsCard label="Employees With Scores" value={currentAnalytics.employees_with_scores} />
          <StatsCard
            label="Current Week Average"
            value={currentAnalytics.current_week_average != null ? currentAnalytics.current_week_average : 0}
          />
          <StatsCard
            label="Week-over-Week Delta"
            value={currentAnalytics.week_over_week_delta != null ? currentAnalytics.week_over_week_delta : 0}
          />
        </section>

        <article className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">Department Code</p>
          <h3>{currentAnalytics.department_anonymized_code}</h3>
          <p>This anonymized code is used across benchmarking widgets instead of real department names.</p>
        </article>

        <div className="mw-panel-grid">
          <article className="mw-card">
            <p className="mw-entity-kicker">Tier Distribution</p>
            <h3>Employees by Threshold Tier</h3>
            <p className="mw-entity-description" style={{ marginBottom: '12px' }}>
              Percentages are calculated at department level with anonymized aggregation.
            </p>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributionData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,43,60,0.07)" />
                  <XAxis dataKey="tier" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, _name: string, props) => [
                      `${value.toFixed(2)}% (${props?.payload?.count ?? 0})`,
                      'Employees',
                    ]}
                    contentStyle={{ fontSize: 13, borderRadius: 10, border: '1px solid rgba(26,43,60,0.1)' }}
                  />
                  <Bar dataKey="percentage" radius={[8, 8, 0, 0]}>
                    {distributionData.map((item) => (
                      <Cell key={item.tier} fill={item.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="mw-card mw-info-panel">
            <p className="mw-entity-kicker">Overall Health Indicator</p>
            <h3 style={{ color: healthStyle.color }}>{currentAnalytics.health_indicator.label}</h3>
            <p>{currentAnalytics.health_indicator.reason}</p>
            <div className="mw-inline-summary" style={{ marginTop: '10px' }}>
              <span className={`mw-badge ${healthStyle.badge}`}>{currentAnalytics.health_indicator.color.toUpperCase()}</span>
              <span className="mw-helper-text">
                Trend: {currentAnalytics.week_over_week_trend.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <div className="mw-info-panel-actions" style={{ marginTop: '14px' }}>
              <button type="button" className="mw-btn-ghost" onClick={() => { void loadAnalytics(); }}>
                Refresh analytics
              </button>
            </div>
          </article>
        </div>
      </section>
    );
  };

  const renderFacialScoresSection = () => {
    const guard = renderAnalyticsGuard(
      'Facial Scores',
      'Cross-department benchmarking is anonymized and shown only by synthetic department codes.',
    );
    if (guard) return guard;

    const currentAnalytics = analytics as DepartmentManagerAnalytics;
    const comparisonData = currentAnalytics.cross_department_comparison.map((item) => ({
      code: item.anonymized_department_code,
      score: item.average_composite_score ?? 0,
      hasData: item.average_composite_score != null,
      isCurrent: item.is_current_department,
      outlier: item.outlier_status,
    }));

    const comparisonColumns: TableColumn<DepartmentComparisonItem>[] = [
      { key: 'code', title: 'Department Code', render: (item) => item.anonymized_department_code },
      {
        key: 'score',
        title: 'Average Composite',
        render: (item) => (item.average_composite_score != null ? item.average_composite_score.toFixed(2) : '-'),
      },
      { key: 'employees', title: 'Employees', render: (item) => item.total_employees },
      { key: 'scored', title: 'With Scores', render: (item) => item.employees_with_scores },
      {
        key: 'status',
        title: 'Outlier Status',
        render: (item) => {
          if (item.outlier_status === 'higher_than_company_average') {
            return <span className="mw-badge mw-badge-danger">Higher Than Avg</span>;
          }
          if (item.outlier_status === 'lower_than_company_average') {
            return <span className="mw-badge mw-badge-success">Lower Than Avg</span>;
          }
          if (item.outlier_status === 'within_expected_range') {
            return <span className="mw-badge mw-badge-info">Within Range</span>;
          }
          return <span className="mw-badge mw-badge-muted">Insufficient Data</span>;
        },
      },
    ];

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Anonymized Benchmarking</p>
              <h2 className="mw-entity-title">Cross-Department Comparison</h2>
              <p className="mw-entity-description">
                Benchmark your department against other departments in the same company using anonymized department codes.
              </p>
            </div>
          </div>
        </div>

        <section className="mw-stat-grid">
          <StatsCard
            label="Company Average"
            value={currentAnalytics.company_average_composite != null ? currentAnalytics.company_average_composite : 0}
          />
          <StatsCard
            label="Company Std Dev"
            value={currentAnalytics.company_std_dev_composite != null ? currentAnalytics.company_std_dev_composite : 0}
          />
          <StatsCard label="Compared Departments" value={comparisonData.length} />
        </section>

        <article className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">Your Department Code</p>
          <h3>{currentAnalytics.department_anonymized_code}</h3>
          <p>Use this code to identify your bar and row in anonymized cross-department comparisons.</p>
        </article>

        <article className="mw-card">
          <p className="mw-entity-kicker">Anonymized Distribution</p>
          <h3>Department Average Composite Scores</h3>
          <div style={{ height: 280, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,43,60,0.07)" />
                <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number, _name: string, props) => [
                    props?.payload?.hasData ? value.toFixed(2) : 'No data',
                    'Average composite',
                  ]}
                  contentStyle={{ fontSize: 13, borderRadius: 10, border: '1px solid rgba(26,43,60,0.1)' }}
                />
                <Bar dataKey="score" radius={[8, 8, 0, 0]}>
                  {comparisonData.map((item) => (
                    <Cell key={item.code} fill={item.isCurrent ? '#143250' : '#3a8f55'} opacity={item.hasData ? 1 : 0.35} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mw-helper-text" style={{ marginTop: '10px' }}>
            Navy bar indicates your department; green bars represent other anonymized departments.
          </p>
        </article>

        <article className="mw-card">
          <DataTable<DepartmentComparisonItem>
            columns={comparisonColumns}
            items={currentAnalytics.cross_department_comparison}
            getRowId={(item) => item.anonymized_department_code}
            emptyMessage="No department comparison data available yet."
          />
        </article>
      </section>
    );
  };

  const renderQuestionnaireScoresSection = () => {
    const guard = renderAnalyticsGuard(
      'Questionnaire Scores',
      'Questionnaire-driven aggregation is anonymized and represented at the department level only.',
    );
    if (guard) return guard;

    const currentAnalytics = analytics as DepartmentManagerAnalytics;
    const scoredCoverage =
      currentAnalytics.total_employees > 0
        ? (currentAnalytics.employees_with_scores / currentAnalytics.total_employees) * 100
        : 0;

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Questionnaire Aggregation</p>
              <h2 className="mw-entity-title">Anonymized Questionnaire Signals</h2>
              <p className="mw-entity-description">
                Individual responses are not shown. Scores are aggregated to protect employee privacy while guiding interventions.
              </p>
            </div>
          </div>
        </div>

        <section className="mw-stat-grid">
          <StatsCard label="Employees With Scored Sessions" value={currentAnalytics.employees_with_scores} />
          <StatsCard label="Total Employees" value={currentAnalytics.total_employees} />
          <StatsCard label="Scored Coverage %" value={Number(scoredCoverage.toFixed(2))} />
          <StatsCard
            label="Current Composite Avg"
            value={currentAnalytics.current_week_average != null ? currentAnalytics.current_week_average : 0}
          />
        </section>

        <article className="mw-card mw-info-panel">
          <p className="mw-entity-kicker">Privacy Guardrail</p>
          <h3>No employee names are exposed in this module</h3>
          <p>
            Only department-level trends and percentages are shown. Use this aggregate signal to decide whether broader
            support action is needed, without viewing individual questionnaire answers.
          </p>
          <div className="mw-inline-summary" style={{ marginTop: '10px' }}>
            {currentAnalytics.threshold_distribution.map((item) => (
              <span key={item.tier} className="mw-badge mw-badge-muted">
                {item.tier.toUpperCase()}: {formatPercentage(item.percentage)}
              </span>
            ))}
          </div>
        </article>
      </section>
    );
  };

  const renderAverageTrendsSection = () => {
    const guard = renderAnalyticsGuard(
      'Average Trends',
      'Department average composite score for current and previous four weeks, with week-over-week movement.',
    );
    if (guard) return guard;

    const currentAnalytics = analytics as DepartmentManagerAnalytics;
    const weeklyData = currentAnalytics.weekly_averages.map((item) => ({
      week: formatWeekLabel(item.week_start),
      average: item.average_composite_score,
      sessions: item.session_count,
    }));

    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">5-Week Trend</p>
              <h2 className="mw-entity-title">Week-over-Week Composite Trend</h2>
              <p className="mw-entity-description">
                The line chart tracks current week plus previous four weeks to identify trend direction and outlier movement.
              </p>
            </div>
            <span className="mw-badge mw-badge-info">
              Trend: {currentAnalytics.week_over_week_trend.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>

        <section className="mw-stat-grid">
          <StatsCard
            label="Current Week Avg"
            value={currentAnalytics.current_week_average != null ? currentAnalytics.current_week_average : 0}
          />
          <StatsCard
            label="Previous Week Avg"
            value={currentAnalytics.previous_week_average != null ? currentAnalytics.previous_week_average : 0}
          />
          <StatsCard
            label="WoW Delta"
            value={currentAnalytics.week_over_week_delta != null ? currentAnalytics.week_over_week_delta : 0}
          />
          <StatsCard label="Weeks Tracked" value={currentAnalytics.weekly_averages.length} />
        </section>

        <article className="mw-card">
          <p className="mw-entity-kicker">Trend Line</p>
          <h3>Department Average Composite Score</h3>
          <div style={{ height: 280, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,43,60,0.07)" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: unknown, _name: string, payload: any) => {
                    const numericValue = typeof value === 'number' ? value : Number(value);
                    const rendered = Number.isFinite(numericValue) ? numericValue.toFixed(2) : 'No data';
                    return [rendered, `Avg Composite (Sessions: ${payload?.payload?.sessions ?? 0})`];
                  }}
                  contentStyle={{ fontSize: 13, borderRadius: 10, border: '1px solid rgba(26,43,60,0.1)' }}
                />
                <Line type="monotone" dataKey="average" stroke="#143250" strokeWidth={2.5} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
    );
  };

  const renderSection = () => {
    if (activeSectionId === 'overview') {
      return renderOverview();
    }

    if (!summary) {
      if (summaryLoading) {
        return <div className="mw-card mw-loading-card">Loading department context...</div>;
      }
      return (
        <div className="mw-card mw-empty-state">
          <h3>Department context unavailable</h3>
          <p>Retry loading to continue managing your assigned department.</p>
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

    if (activeSectionId === 'compliance') {
      return renderComplianceSection();
    }

    if (activeSectionId === 'reports') {
      return renderReportsSection();
    }

    if (activeSectionId === 'employees') {
      return (
        <EntitySection<EmployeeProfile>
          title="Employees"
          description={`Manage employees in ${summary.department_name} (${summary.company_name}).`}
          createButtonLabel="Invite Employee"
          columns={employeeColumns}
          fields={[
            { name: 'full_name', label: 'Full Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'company_name', label: 'Company', type: 'text', disabled: true },
            { name: 'department_name', label: 'Department', type: 'text', disabled: true },
            { name: 'employee_code', label: 'Employee Code (Optional)', type: 'text' },
            { name: 'job_title', label: 'Job Title (Optional)', type: 'text' },
            activeField,
          ]}
          rowActions={employeeRowActions}
          reloadKey={sectionReloadKey}
          fetchItems={(query) =>
            employeesApi.list({
              ...query,
              companyId: summary.company_id,
              departmentId: summary.department_id,
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
            company_name: summary.company_name,
            department_name: summary.department_name,
            employee_code: item?.employee_code ?? '',
            job_title: item?.job_title ?? '',
            is_active: item?.user?.is_active ?? false,
          })}
          toCreatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: summary.company_id,
            department_id: summary.department_id,
            employee_code: String(values.employee_code || '').trim() || null,
            job_title: String(values.job_title || '').trim() || null,
          })}
          toUpdatePayload={(values) => ({
            full_name: String(values.full_name).trim(),
            email: String(values.email).trim(),
            company_id: summary.company_id,
            department_id: summary.department_id,
            employee_code: String(values.employee_code || '').trim() || null,
            job_title: String(values.job_title || '').trim() || null,
            is_active: Boolean(values.is_active),
          })}
          validate={(values) => validateEmployeeForm(values)}
          createSuccessMessage="Invitation sent successfully"
          onAfterChange={refreshAfterChange}
        />
      );
    }

    if (activeSectionId === 'detection-analytics') {
      return renderDetectionAnalyticsSection();
    }

    if (activeSectionId === 'facial-scores') {
      return renderFacialScoresSection();
    }

    if (activeSectionId === 'questionnaire-scores') {
      return renderQuestionnaireScoresSection();
    }

    if (activeSectionId === 'average-trends') {
      return renderAverageTrendsSection();
    }

    if (activeSectionId === 'invitations') {
      return (
        <EntitySection<InvitationListItem>
          title="Invitations"
          description="Track employee invitation status and keep onboarding moving in your department."
          showCreateButton={false}
          enableEdit={false}
          enableDelete={false}
          columns={invitationColumns}
          fields={[]}
          filters={[
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
          ]}
          rowActions={invitationRowActions}
          reloadKey={sectionReloadKey}
          fetchItems={(query) =>
            invitationsApi.list({
              ...(query as InvitationListQuery),
              role: 'employee',
              companyId: summary.company_id,
              departmentId: summary.department_id,
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
      title="Department Manager Dashboard"
      subtitle="Manage only your assigned department with secure role-based limits and future-ready analytics modules."
      roleLabel="Department Manager"
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
