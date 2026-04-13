import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { BrandedFullPageError } from '../components/feedback/BrandedFullPageError';
import { BrandedFullPageLoader } from '../components/feedback/BrandedFullPageLoader';
import type { UserRole } from '../types/domain';
import { getDashboardPathByRole } from '../utils/roles';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
}

export const ProtectedRoute = ({ allowedRoles }: ProtectedRouteProps) => {
  const { user, isInitializing, initializationError, retryInitialization } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[MindWell][RouteGuard]', {
      path: location.pathname,
      isInitializing,
      hasUser: Boolean(user),
      userRole: user?.role ?? null,
      allowedRoles: allowedRoles ?? null,
    });
  }, [location.pathname, isInitializing, user, allowedRoles]);

  if (isInitializing) {
    return (
      <BrandedFullPageLoader
        title="Restoring your secure workspace"
        description="Checking session and route permissions before opening the dashboard."
      />
    );
  }

  if (initializationError) {
    return (
      <BrandedFullPageError
        title="Session restore failed"
        message={initializationError}
        onRetry={() => {
          void retryInitialization();
        }}
        secondaryLabel="Go to Sign In"
        secondaryTo="/sign-in"
      />
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getDashboardPathByRole(user.role)} replace />;
  }

  return <Outlet />;
};
