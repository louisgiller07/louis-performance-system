import type { RaceHorizon, TodayRace } from "../today/todayContext";

// UX-07 — the top of History: "Historique" is the feature, "Ton parcours" is
// what it means. The context line is the same race / objective as Today and
// Programme (race horizon rule UX-04/05), hidden when there is none.
function contextLine(horizon: RaceHorizon<TodayRace> | null, objective: string | null): string | null {
  if (horizon?.kind === "ongoing") return `⚑ En course · ${horizon.race.eventName}`;
  if (horizon?.kind === "countdown") return `⚑ Prochaine course · ${horizon.race.eventName} · ${horizon.days === 1 ? "demain" : `J-${horizon.days}`}`;
  if (horizon?.kind === "horizon") return `Objectif de saison · ${horizon.race.eventName}`;
  return objective ? `Objectif : ${objective}` : null;
}

export function HistoryJourneyHero({ horizon, objective }: { horizon: RaceHorizon<TodayRace> | null; objective: string | null }) {
  const context = contextLine(horizon, objective);
  return (
    <section aria-labelledby="history-title" className="ux-enter ux-grain relative overflow-hidden rounded-2xl border border-gold/40 bg-card p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-gold/10 via-transparent to-transparent" aria-hidden="true" />
      <p className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Historique
      </p>
      <h1 id="history-title" className="mt-4 font-display text-[clamp(2.25rem,10vw,3rem)] font-extrabold uppercase leading-[0.95] text-ink">
        Ton parcours
        <span className="block text-gold">évolue avec tes décisions</span>
      </h1>
      {context && <p className="mt-4 border-t border-line pt-4 text-sm text-ink/85">{context}</p>}
    </section>
  );
}
