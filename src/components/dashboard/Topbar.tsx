import type { User } from '../../types/domain';

interface TopbarProps {
  title: string;
  subtitle: string;
  user: User;
  onToggleSidebar: () => void;
  onLogout: () => void;
}

export const Topbar = ({ title, subtitle, user, onToggleSidebar, onLogout }: TopbarProps) => {
  return (
    <header className="mw-admin-topbar">
      <div className="mw-admin-topbar-row">
        <div className="mw-admin-topbar-heading">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="mw-sidebar-toggle"
            aria-label="Toggle sidebar"
          >
            Menu
          </button>
          <div className="mw-admin-topbar-copy">
            <h1 className="mw-admin-topbar-title">{title}</h1>
            <p className="mw-admin-topbar-subtitle">{subtitle}</p>
          </div>
        </div>

        <div className="mw-admin-user-meta">
          <div className="mw-admin-user-pill mw-visible-md">{user.full_name}</div>
          <button type="button" onClick={onLogout} className="mw-btn-primary">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};
