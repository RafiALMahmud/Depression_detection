import { Navigate, Route, Routes } from 'react-router-dom';

import App from '../App';
import { SignInPage } from '../pages/SignInPage';
import { InvitationSignupPage } from '../pages/InvitationSignupPage';
import { SuperAdminDashboardPage } from '../pages/SuperAdminDashboardPage';
import { SystemAdminDashboardPage } from '../pages/SystemAdminDashboardPage';
import { RolePortalPage } from '../pages/RolePortalPage';
import { ProtectedRoute } from './ProtectedRoute';

export const AppRouter = () => {
  return (
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

      <Route element={<ProtectedRoute allowedRoles={['company_head', 'department_manager', 'employee']} />}>
        <Route path="/dashboard/company-head" element={<RolePortalPage />} />
        <Route path="/dashboard/department-manager" element={<RolePortalPage />} />
        <Route path="/dashboard/employee" element={<RolePortalPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
