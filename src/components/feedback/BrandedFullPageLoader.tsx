interface BrandedFullPageLoaderProps {
  title?: string;
  description?: string;
}

export const BrandedFullPageLoader = ({
  title = 'Preparing your MindWell workspace',
  description = 'Verifying your session and loading the dashboard safely.',
}: BrandedFullPageLoaderProps) => {
  return (
    <div className="mw-auth-page">
      <div className="mw-auth-shell">
        <div className="mw-card p-8 md:p-10">
          <p className="mw-section-label">Loading</p>
          <h1 className="mw-section-title">
            {title}
          </h1>
          <p className="mw-section-subtitle">{description}</p>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-cream-dark">
            <div className="mw-loader-bar h-full w-2/5 rounded-full bg-green-500" />
          </div>
        </div>
      </div>
    </div>
  );
};

