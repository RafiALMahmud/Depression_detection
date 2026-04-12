interface StatsCardProps {
  label: string;
  value: number;
}

export const StatsCard = ({ label, value }: StatsCardProps) => {
  return (
    <article className="mw-card mw-stat-card">
      <p className="mw-stat-label">{label}</p>
      <p className="mw-stat-value">{value}</p>
    </article>
  );
};
