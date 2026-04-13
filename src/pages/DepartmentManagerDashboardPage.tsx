import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  dashboardApi,
  employeesApi,
  invitationsApi,
  type EmployeePayload,
  type EmployeeUpdatePayload,
  type InvitationListQuery,
} from '../api/services';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/dashboard/AppShell';
import { EntitySection } from '../components/dashboard/EntitySection';
import { StatsCard } from '../components/dashboard/StatsCard';
import type { FormFieldConfig, RowAction, TableColumn } from '../components/dashboard/types';
import type { DepartmentManagerSummary, EmployeeProfile, InvitationListItem } from '../types/domain';
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

export const DepartmentManagerDashboardPage = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [activeSectionId, setActiveSectionId] = useState<string>('overview');
  const [summary, setSummary] = useState<DepartmentManagerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [sectionReloadKey, setSectionReloadKey] = useState(0);
  const summaryRunRef = useRef(0);

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

  useEffect(() => {
    if (!allowed) return;
    void loadSummary();
  }, [allowed, loadSummary]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[MindWell][DepartmentManager] state', {
      section: activeSectionId,
      summaryLoading,
      hasSummaryError: Boolean(summaryError),
    });
  }, [activeSectionId, summaryLoading, summaryError]);

  const refreshAfterChange = useCallback(async () => {
    await loadSummary();
  }, [loadSummary]);

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

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'employees', label: 'Employees' },
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
            <p className="mw-entity-kicker">Upcoming Modules</p>
            <h3>Analytics Roadmap</h3>
            <p>
              Detection analytics, facial score anonymization, questionnaire score trends, and wellness-average charts
              are scaffolded and ready for backend model integration.
            </p>
            <span className="mw-coming-soon-pill">Coming Soon</span>
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

  const renderPlaceholderSection = (
    title: string,
    description: string,
    cards: Array<{ title: string; copy: string }>,
  ) => {
    return (
      <section className="mw-entity-layout">
        <div className="mw-card mw-entity-header">
          <div className="mw-entity-header-row">
            <div>
              <p className="mw-entity-kicker">Analytics Module</p>
              <h2 className="mw-entity-title">{title}</h2>
              <p className="mw-entity-description">{description}</p>
            </div>
            <span className="mw-coming-soon-pill">Coming Soon</span>
          </div>
        </div>

        <div className="mw-placeholder-grid">
          {cards.map((card) => (
            <article key={card.title} className="mw-card mw-placeholder-card">
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
              <div className="mw-chart-placeholder" role="presentation" />
            </article>
          ))}
        </div>
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
      return renderPlaceholderSection(
        'Detection Analytics',
        'This module will track scan completion and detection readiness for your department.',
        [
          {
            title: 'Employees Scanned',
            copy: 'Planned metric for counting completed detection scans in your department.',
          },
          {
            title: 'Scan Completion Rate',
            copy: 'Planned completion trend widget comparing total employees versus scanned employees.',
          },
          {
            title: 'Detection Overview',
            copy: 'Future breakdown cards for weekly and monthly detection activity snapshots.',
          },
        ],
      );
    }

    if (activeSectionId === 'facial-scores') {
      return renderPlaceholderSection(
        'Facial Scores',
        'This page will display anonymized facial detection scores for your department without exposing employee names.',
        [
          {
            title: 'Anonymized Score Table',
            copy: 'Planned table with department-only score entries, no personal identity columns.',
          },
          {
            title: 'Distribution Bands',
            copy: 'Planned chart showing score ranges and concentration over time.',
          },
          {
            title: 'Flag Summary',
            copy: 'Future indicator cards for low, moderate, and high-risk trend segments.',
          },
        ],
      );
    }

    if (activeSectionId === 'questionnaire-scores') {
      return renderPlaceholderSection(
        'Questionnaire Scores',
        'This module will surface anonymized adaptive questionnaire outcomes at department level.',
        [
          {
            title: 'Adaptive Response Trends',
            copy: 'Planned trends from adaptive questionnaire responses without individual identity.',
          },
          {
            title: 'Department Score Buckets',
            copy: 'Planned distribution cards for low/moderate/high questionnaire score groups.',
          },
          {
            title: 'Readiness Heatmap',
            copy: 'Future heatmap-style view of aggregated questionnaire severity levels.',
          },
        ],
      );
    }

    if (activeSectionId === 'average-trends') {
      return renderPlaceholderSection(
        'Average Trends',
        'Future graphs for department-level average wellness and mental-health trajectory tracking.',
        [
          {
            title: 'Average Score Timeline',
            copy: 'Planned line chart visualizing average wellness score across selected periods.',
          },
          {
            title: 'Multi-Signal Blend',
            copy: 'Future blended indicator combining detection and questionnaire channels.',
          },
          {
            title: 'Trend Alerts',
            copy: 'Planned alert panel for sudden changes in department average metrics.',
          },
        ],
      );
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
