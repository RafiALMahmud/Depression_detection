import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  companiesApi,
  companyHeadsApi,
  dashboardApi,
  departmentManagersApi,
  departmentsApi,
  employeesApi,
  invitationsApi,
  optionsApi,
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
  Department,
  DepartmentManagerProfile,
  DepartmentOption,
  EmployeeProfile,
  SuperAdminSummary,
  SystemAdminProfile,
  SystemAdminSummary,
  User,
} from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

type DashboardMode = 'super' | 'system';
type FormValues = Record<string, string | boolean>;
type InviteManagedProfile = CompanyHeadProfile | DepartmentManagerProfile | EmployeeProfile;

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

  if (item.user.is_active) return badge('Active', 'mw-badge-success');
  const status = item.invitation?.status;
  if (!status || status === 'pending') return badge('Pending', 'mw-badge-warning');
  if (status === 'used') return badge('Used', 'mw-badge-info');
  if (status === 'expired') return badge('Expired', 'mw-badge-danger');
  if (status === 'cancelled') return badge('Cancelled', 'mw-badge-muted');
  return badge(status, 'mw-badge-muted');
};

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
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [sectionReloadKey, setSectionReloadKey] = useState(0);

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
    setSummaryLoading(true);
    try {
      const response = isSuperMode ? await dashboardApi.superAdminSummary() : await dashboardApi.systemAdminSummary();
      setSummary(response);
    } catch (error) {
      toast.error('Failed to load dashboard summary');
      console.error(error);
    } finally {
      setSummaryLoading(false);
    }
  }, [isSuperMode]);

  const loadLookupOptions = useCallback(async () => {
    try {
      const [companies, departments] = await Promise.all([optionsApi.companies(), optionsApi.departments()]);
      setCompanyOptions(companies);
      setDepartmentOptions(departments);
    } catch (error) {
      toast.error('Failed to load form options');
      console.error(error);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void Promise.all([loadSummary(), loadLookupOptions()]);
  }, [allowed, loadSummary, loadLookupOptions]);

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
        hidden: (item) => !item.invitation || item.user.is_active || item.invitation.status === 'used',
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
        hidden: (item) => !item.invitation || item.user.is_active || item.invitation.status !== 'pending',
      },
    ],
    [handleInvitationCancel, handleInvitationResend],
  );

  if (!user) return <Navigate to="/sign-in" replace />;
  if (!allowed) return <Navigate to={getDashboardPathByRole(user.role)} replace />;

  const sections = isSuperMode
    ? [
        { id: 'overview', label: 'Overview' },
        ...(isPrimarySuperAdmin ? [{ id: 'super-admins', label: 'Super Admins' }] : []),
        { id: 'system-admins', label: 'System Admins' },
        { id: 'companies', label: 'Companies' },
        { id: 'company-heads', label: 'Company Heads' },
        { id: 'departments', label: 'Departments' },
        { id: 'department-managers', label: 'Department Managers' },
        { id: 'employees', label: 'Employees' },
      ]
    : [
        { id: 'overview', label: 'Overview' },
        { id: 'companies', label: 'Companies' },
        { id: 'company-heads', label: 'Company Heads' },
        { id: 'departments', label: 'Departments' },
        { id: 'department-managers', label: 'Department Managers' },
        { id: 'employees', label: 'Employees' },
      ];

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId('overview');
    }
  }, [activeSectionId, sections]);

  const renderOverview = () => {
    if (summaryLoading || !summary) {
      return <div className="mw-card mw-loading-card">Loading overview...</div>;
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

  const systemAdminColumns: TableColumn<SystemAdminProfile>[] = [
    { key: 'full_name', title: 'Name', render: (item) => item.user.full_name },
    { key: 'email', title: 'Email', render: (item) => item.user.email },
    { key: 'status', title: 'Status', render: (item) => (item.user.is_active ? 'Active' : 'Inactive') },
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
    { key: 'full_name', title: 'Name', render: (item) => item.user.full_name },
    { key: 'email', title: 'Email', render: (item) => item.user.email },
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
    { key: 'name', title: 'Name', render: (item) => item.user.full_name },
    { key: 'email', title: 'Email', render: (item) => item.user.email },
    { key: 'company', title: 'Company', render: (item) => companyNameMap.get(item.company_id) ?? `#${item.company_id}` },
    { key: 'department', title: 'Department', render: (item) => departmentNameMap.get(item.department_id) ?? `#${item.department_id}` },
    { key: 'onboarding', title: 'Onboarding', render: (item) => renderInvitationBadge(item) },
  ];

  const employeeColumns: TableColumn<EmployeeProfile>[] = [
    { key: 'name', title: 'Name', render: (item) => item.user.full_name },
    { key: 'email', title: 'Email', render: (item) => item.user.email },
    { key: 'company', title: 'Company', render: (item) => companyNameMap.get(item.company_id) ?? `#${item.company_id}` },
    { key: 'department', title: 'Department', render: (item) => departmentNameMap.get(item.department_id) ?? `#${item.department_id}` },
    { key: 'code', title: 'Employee Code', render: (item) => item.employee_code || '-' },
    { key: 'job_title', title: 'Job Title', render: (item) => item.job_title || '-' },
    { key: 'onboarding', title: 'Onboarding', render: (item) => renderInvitationBadge(item) },
  ];

  const entityComponent = () => {
    if (activeSectionId === 'overview') {
      return renderOverview();
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
          getDeleteLabel={(item) => item.user.email}
          toFormValues={(item) => ({
            full_name: item?.user.full_name ?? '',
            email: item?.user.email ?? '',
            password: '',
            is_active: item?.user.is_active ?? true,
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
          getDeleteLabel={(item) => item.user.email}
          toFormValues={(item) => ({
            full_name: item?.user.full_name ?? '',
            email: item?.user.email ?? '',
            company_id: item ? String(item.company_id) : '',
            is_active: item?.user.is_active ?? false,
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
          getDeleteLabel={(item) => item.user.email}
          toFormValues={(item) => ({
            full_name: item?.user.full_name ?? '',
            email: item?.user.email ?? '',
            company_id: item ? String(item.company_id) : '',
            department_id: item ? String(item.department_id) : '',
            is_active: item?.user.is_active ?? false,
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
          getDeleteLabel={(item) => item.user.email}
          toFormValues={(item) => ({
            full_name: item?.user.full_name ?? '',
            email: item?.user.email ?? '',
            company_id: item ? String(item.company_id) : '',
            department_id: item ? String(item.department_id) : '',
            job_title: item?.job_title ?? '',
            is_active: item?.user.is_active ?? false,
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
