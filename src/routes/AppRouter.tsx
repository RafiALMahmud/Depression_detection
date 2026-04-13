import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import App from '../App';
import { useAuth } from '../auth/AuthContext';
import { SignInPage } from '../pages/SignInPage';
import { InvitationSignupPage } from '../pages/InvitationSignupPage';
import { SuperAdminDashboardPage } from '../pages/SuperAdminDashboardPage';
import { SystemAdminDashboardPage } from '../pages/SystemAdminDashboardPage';
import { CompanyHeadDashboardPage } from '../pages/CompanyHeadDashboardPage';
import { DepartmentManagerDashboardPage } from '../pages/DepartmentManagerDashboardPage';
import { RolePortalPage } from '../pages/RolePortalPage';
import { ProtectedRoute } from './ProtectedRoute';

const RouteDebugObserver = () => {
  const location = useLocation();
  const { user, isInitializing, initializationError } = useAuth();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[MindWell][Route]', {
      path: location.pathname,
      isInitializing,
      initializationError,
      userRole: user?.role ?? null,
    });
  }, [location.pathname, isInitializing, initializationError, user?.role]);

  return null;
};

export const AppRouter = () => {
  return (
    <>
      <RouteDebugObserver />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/signup" element={<InvitationSignupPage />} />

        <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
          <Route path="/dashboard/super-admin" element={<SuperAdminDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={['system_admin']} />}>
          <Route path="/dashboard/system-admin" element={<SystemAdminDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={['company_head']} />}>
          <Route path="/dashboard/company-head" element={<CompanyHeadDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={['department_manager']} />}>
          <Route path="/dashboard/department-manager" element={<DepartmentManagerDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={['employee']} />}>
          <Route path="/dashboard/employee" element={<RolePortalPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};
