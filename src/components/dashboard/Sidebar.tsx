import { Link } from 'react-router-dom';

interface SidebarSection {
  id: string;
  label: string;
}

interface SidebarProps {
  sections: SidebarSection[];
  roleLabel: string;
  activeSectionId: string;
  onSelect: (sectionId: string) => void;
}

export const Sidebar = ({ sections, roleLabel, activeSectionId, onSelect }: SidebarProps) => {
  return (
    <aside className="mw-sidebar">
      <div className="mw-sidebar-brand">
        <Link to="/" className="mw-sidebar-brand-link" aria-label="Go to MindWell landing page">
          <div className="mw-sidebar-brand-title">
            Mind<span>Well</span>
          </div>
        </Link>
        <p className="mw-sidebar-brand-copy">Corporate wellness command center</p>
        <span className="mw-sidebar-role">{roleLabel}</span>
      </div>

      <p className="mw-sidebar-caption">Navigation</p>
      <nav className="mw-sidebar-nav" aria-label="Dashboard sections">
        {sections.map((section) => {
          const active = section.id === activeSectionId;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelect(section.id)}
              className={`mw-sidebar-item ${active ? 'active' : ''}`}
            >
              {section.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
