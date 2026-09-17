// V0.3 UX PREMIUM — HistoryPage redesign, Phase 1. Purely static chrome —
// no data, no props, same "no invented data" discipline as TodayPage's own
// Hero. The three-word column (Progresser/Apprendre/Plus loin) is
// decorative framing text, not a claim about the athlete's actual
// progress — real progress signals live in the cards below, sourced from
// DailyPlan/completed_sessions as already established.
const FRAMING_WORDS = ["Progresser", "Apprendre", "Plus loin"];

export function HistoryHero() {
  return (
    <div
      className="flex min-h-37.5 items-center justify-between gap-4 overflow-hidden rounded-xl border border-white/5 p-5"
      style={{ background: "linear-gradient(135deg, #12151A 0%, #08090B 100%)" }}
    >
      <div>
        <h1 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Historique</h1>
        <p className="mt-2 text-xl font-bold text-ink">Tes dernières séances</p>
        <p className="mt-1 max-w-55 text-sm text-ink/70">Analyse ta progression et revis tes décisions du coach.</p>
      </div>
      <ul className="shrink-0 text-right text-xs font-semibold uppercase tracking-wide text-muted">
        {FRAMING_WORDS.map((word) => (
          <li key={word} className="flex items-center justify-end gap-2 py-1">
            {word}
            <span aria-hidden="true" className="inline-block h-px w-4 bg-gold" />
          </li>
        ))}
      </ul>
    </div>
  );
}
