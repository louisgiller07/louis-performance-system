interface SectionHeaderProps {
  title: string;
  subtitle?: string;
}

// V0.3 UX PREMIUM — Global App Redesign. Standardizes the small
// uppercase-label + one-line-subtitle pattern used for page titles and
// section headings across the app (e.g. TodayPage's "Aujourd'hui" date
// card) — replaces each page's own ad hoc <h1>/<p> pairing.
export function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <div>
      <h1 className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink/70">{subtitle}</p>}
    </div>
  );
}
