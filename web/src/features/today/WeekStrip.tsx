import { Link } from "react-router-dom";
import { WeekDaysPicker } from "../../components/WeekDaysPicker";
import type { WeekSummary } from "./todayContext";

// UX-04 / UX-05 — "Cette semaine": Monday → Sunday as a training notebook,
// not a tracker. Plain counts of existing rows (planned, performed) and the
// shared day strip (components/WeekDaysPicker.tsx, also used by Programme).
// No chart, gauge, score or percentage.

/** Singular only for exactly one ("1 séance prévue", "0 réalisées", "5 séances prévues"). */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function WeekStrip({ week }: { week: WeekSummary }) {
  return (
    <section aria-labelledby="week-title" className="ux-enter rounded-xl border border-line bg-card p-5">
      <h2 id="week-title" className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Cette semaine
      </h2>
      <div className="mt-3 flex items-baseline gap-5">
        <p className="font-display text-2xl font-extrabold uppercase leading-none text-ink">{plural(week.plannedCount, "séance prévue", "séances prévues")}</p>
        <p className="font-display text-2xl font-extrabold uppercase leading-none text-gold">{plural(week.performedCount, "réalisée", "réalisées")}</p>
      </div>

      <WeekDaysPicker days={week.days} />

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">✓ réalisée · ● aujourd'hui · ○ prévue · ⚑ course</p>
        <Link to="/training-plan" className="ux-press shrink-0 text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
          Programme →
        </Link>
      </div>
    </section>
  );
}
