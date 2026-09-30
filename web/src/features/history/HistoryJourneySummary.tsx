import type { JourneyFacts } from "./historyDays";

// UX-07 — "Ton parcours": plain counts of the days shown above, since the
// first loaded day. No season (none is recorded), no score, no percentage,
// no trend.
const SINCE_FORMAT = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" });

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function HistoryJourneySummary({ facts }: { facts: JourneyFacts }) {
  const [y, m, d] = facts.since.split("-").map(Number);
  const lines: [number, string][] = [
    [facts.analysedDays, plural(facts.analysedDays, "journée accompagnée", "journées accompagnées")],
    [facts.adaptations, plural(facts.adaptations, "adaptation", "adaptations")],
  ];
  if (facts.safetyRests > 0) lines.push([facts.safetyRests, plural(facts.safetyRests, "repos sécurité", "repos sécurité")]);
  lines.push([facts.recordedSessions, plural(facts.recordedSessions, "séance enregistrée", "séances enregistrées")]);
  if (facts.unrecordedSessions > 0) lines.push([facts.unrecordedSessions, plural(facts.unrecordedSessions, "séance non enregistrée", "séances non enregistrées")]);

  return (
    <section aria-labelledby="journey-title" className="ux-enter rounded-2xl border border-line bg-card p-5">
      <h2 id="journey-title" className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Ton parcours
      </h2>
      <p className="mt-1 text-sm text-muted">{`depuis le ${SINCE_FORMAT.format(new Date(y!, m! - 1, d!))}`}</p>
      <ul className="mt-3 flex flex-col">
        {lines.map(([count, label]) => (
          <li key={label} className="flex items-baseline gap-3 border-b border-line py-2.5 last:border-b-0">
            <span className="w-10 font-display text-3xl font-extrabold leading-none text-gold">{count}</span>
            <span className="text-sm uppercase tracking-[0.12em] text-ink/85">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
