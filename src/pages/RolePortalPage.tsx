import { Navigate, Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { getDashboardPathByRole, ROLE_LABELS } from '../utils/roles';

export const RolePortalPage = () => {
  const { user, signOut } = useAuth();

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

  const roleLabel = ROLE_LABELS[user.role];

  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between">
          <Link className="logo" to="/">
            Mind<span>Well</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="nav-cta"
          >
            Logout
          </button>
        </header>

        <section className="mw-card p-8 md:p-10">
          <p className="section-label">Role workspace</p>
          <h1 className="font-serif text-4xl text-navy">{roleLabel} Dashboard</h1>
          <p className="mt-4 text-sm text-text-muted">
            You are signed in successfully. Dedicated modules for this role can be extended in the same theme as the
            admin dashboards.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="mw-btn-primary" to={getDashboardPathByRole(user.role)}>
              Refresh Page
            </Link>
            <Link className="mw-btn-ghost" to="/">
              Go to Landing
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
};

