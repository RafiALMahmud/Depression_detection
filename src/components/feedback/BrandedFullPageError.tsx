import { Link } from 'react-router-dom';

interface BrandedFullPageErrorProps {
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  secondaryLabel?: string;
  secondaryTo?: string;
  secondaryOnClick?: () => void;
}

export const BrandedFullPageError = ({
  title = 'We hit a dashboard loading issue',
  message,
  retryLabel = 'Try again',
  onRetry,
  secondaryLabel,
  secondaryTo,
  secondaryOnClick,
}: BrandedFullPageErrorProps) => {
  return (
    <div className="mw-auth-page">
      <div className="mw-auth-shell">
        <div className="mw-card p-8 md:p-10">
          <p className="mw-section-label">Something went wrong</p>
          <h1 className="mw-section-title">{title}</h1>
          <p className="mw-section-subtitle">{message}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {onRetry ? (
              <button type="button" className="mw-btn-primary" onClick={onRetry}>
                {retryLabel}
              </button>
            ) : null}
            {secondaryLabel && secondaryOnClick ? (
              <button type="button" className="mw-btn-ghost" onClick={secondaryOnClick}>
                {secondaryLabel}
              </button>
            ) : null}
            {secondaryLabel && secondaryTo && !secondaryOnClick ? (
              <Link to={secondaryTo} className="mw-btn-ghost">
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
