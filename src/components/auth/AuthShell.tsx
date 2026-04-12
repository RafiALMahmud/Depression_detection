import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthFeature {
  title: string;
  description: string;
}

interface AuthShellProps {
  label: string;
  title: ReactNode;
  description: string;
  topActionLabel: string;
  topActionTo: string;
  features: AuthFeature[];
  footerNote?: ReactNode;
  children: ReactNode;
}

export const AuthShell = ({
  label,
  title,
  description,
  topActionLabel,
  topActionTo,
  features,
  footerNote,
  children,
}: AuthShellProps) => {
  return (
    <div className="mw-auth-page">
      <div className="mw-auth-shell">
        <header className="mw-auth-header">
          <Link className="logo" to="/">
            Mind<span>Well</span>
          </Link>
          <Link className="nav-cta" to={topActionTo}>
            {topActionLabel}
          </Link>
        </header>

        <div className="mw-auth-layout">
          <section className="mw-auth-brand-card">
            <p className="mw-section-label">{label}</p>
            <h1 className="mw-section-title">{title}</h1>
            <p className="mw-section-subtitle">{description}</p>

            <div className="mw-auth-feature-grid">
              {features.map((feature) => (
                <article key={feature.title} className="mw-auth-feature">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>

            {footerNote ? <div className="mw-auth-footer-note">{footerNote}</div> : null}
          </section>

          <section className="mw-auth-form-card">{children}</section>
        </div>
      </div>
    </div>
  );
};
