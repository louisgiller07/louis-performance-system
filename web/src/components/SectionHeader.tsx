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
      <h1 className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        {title}
      </h1>
      {subtitle && <p className="mt-1.5 text-sm text-ink/70">{subtitle}</p>}
    </div>
  );
}
