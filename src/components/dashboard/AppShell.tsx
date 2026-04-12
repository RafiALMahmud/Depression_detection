import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { User } from '../../types/domain';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppShellSection {
  id: string;
  label: string;
}

interface AppShellProps {
  title: string;
  subtitle: string;
  roleLabel: string;
  user: User;
  sections: AppShellSection[];
  activeSectionId: string;
  onSelectSection: (id: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export const AppShell = ({
  title,
  subtitle,
  roleLabel,
  user,
  sections,
  activeSectionId,
  onSelectSection,
  onLogout,
  children,
}: AppShellProps) => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeLabel = useMemo(
    () => sections.find((section) => section.id === activeSectionId)?.label ?? title,
    [sections, activeSectionId, title],
  );

  return (
    <div className="mw-admin-page">
      <div className="mw-admin-shell">
        <div className="mw-admin-layout">
          <div className="mw-admin-sidebar-slot">
            <Sidebar
              sections={sections}
              roleLabel={roleLabel}
              activeSectionId={activeSectionId}
              onSelect={(id) => {
                onSelectSection(id);
                setMobileSidebarOpen(false);
              }}
            />
          </div>

          {mobileSidebarOpen && (
            <div
              className="mw-admin-drawer-backdrop"
              onClick={() => setMobileSidebarOpen(false)}
              role="presentation"
              aria-label="Close sidebar overlay"
            >
              <div className="mw-admin-drawer-panel" onClick={(event) => event.stopPropagation()} role="presentation">
                <Sidebar
                  sections={sections}
                  roleLabel={roleLabel}
                  activeSectionId={activeSectionId}
                  onSelect={(id) => {
                    onSelectSection(id);
                    setMobileSidebarOpen(false);
                  }}
                />
              </div>
            </div>
          )}

          <main className="mw-admin-main">
            <Topbar
              title={title}
              subtitle={`Current section: ${activeLabel}`}
              user={user}
              onToggleSidebar={() => setMobileSidebarOpen((prev) => !prev)}
              onLogout={onLogout}
            />
            {subtitle ? <p className="mw-admin-subtitle-banner">{subtitle}</p> : null}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
};
