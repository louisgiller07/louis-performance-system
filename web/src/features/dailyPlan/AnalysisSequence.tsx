// UX-03 — what the athlete sees while the daily run is in flight
// ("NALYNT analyse…"). Purely cosmetic: the lines tick in on a fixed CSS
// schedule and say nothing about the actual computation or its result —
// only which inputs the coach reads (the same ones the check-in collected,
// plus the planned session). The real result replaces this card as soon as
// it arrives (DailyPlanPanel).
const LINES = ["Sommeil et récupération", "Énergie et fatigue", "Santé", "Ta séance prévue"];

export function AnalysisSequence() {
  return (
    <section role="status" aria-live="polite" className="ux-grain ux-enter relative overflow-hidden rounded-2xl border border-gold/40 bg-card p-6">
      <p className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="analysis-dot h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
        Analyse
      </p>
      <p className="mt-4 font-display text-4xl font-extrabold uppercase leading-none text-ink">NALYNT analyse…</p>
      <ul className="mt-6 flex flex-col gap-3" aria-hidden="true">
        {LINES.map((line, index) => (
          <li key={line} className="analysis-line flex items-center justify-between border-b border-line pb-3 text-sm text-ink/80" style={{ ["--i" as string]: index }}>
            {line}
            <span className="analysis-check text-gold">✓</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 h-[3px] overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className="analysis-bar block h-full w-full origin-left bg-gold" />
      </div>
    </section>
  );
}
