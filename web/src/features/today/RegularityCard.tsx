// UX-05 — "Ta régularité": what NALYNT observes, nothing more. Today's
// check-in (with its Modifier action) and the number of days with a check-in
// this week (Monday → today). No streak, no score, no reward, no judgment —
// NALYNT observes, it does not applaud. Not rendered when there is nothing
// to say (no check-in this week).
export function RegularityCard({ checkedInToday, weekCount, onEditCheckin }: { checkedInToday: boolean; weekCount: number; onEditCheckin: () => void }) {
  if (!checkedInToday && weekCount === 0) return null;

  return (
    <section aria-labelledby="regularity-title" className="ux-enter rounded-xl border border-line bg-card px-5 py-4">
      <h2 id="regularity-title" className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Ta régularité
      </h2>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          {checkedInToday && (
            <p className="flex items-center gap-2 text-sm text-ink">
              <span className="text-gold" aria-hidden="true">
                ✓
              </span>
              Check-in aujourd'hui
            </p>
          )}
          {weekCount > 0 && (
            <p className="text-sm text-ink/80">
              {weekCount} check-in{weekCount > 1 ? "s" : ""} cette semaine
            </p>
          )}
        </div>
        {checkedInToday && (
          <button
            type="button"
            onClick={onEditCheckin}
            className="ux-press min-h-10 shrink-0 rounded border border-line px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink/80 hover:border-gold/60 hover:text-ink"
          >
            Modifier
          </button>
        )}
      </div>
    </section>
  );
}
