import { translateRaceFormat, translateRacePriority } from "../trainingLabels/raceLabels";
import type { RaceHorizon, TodayRace } from "./todayContext";

// UX-05 — Today's context banner: why this day counts. Validated order:
// - a race in progress → "EN COURSE";
// - next race under 120 days → "PROCHAINE COURSE · J-XX";
// - next race between 120 and 365 days → "OBJECTIF DE SAISON";
// - otherwise the athlete's own declared objective → "TON OBJECTIF";
// - nothing real → the banner is not rendered at all (never "aucun objectif").
// Race details (date, location, format, priority) are shown only when the
// race row has them; format and priority go through the existing French
// labels, never raw. The closing line is editorial, never a metric.
const RACE_DATE = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric", month: "long" });

/**
 * SPORT-RACE-01P — the formats with a pre-event protocol (docs/04 §3). In the seven days before any other format (or
 * none), Today says that no specific preparation is defined: NALYNT plans no pre-event session for it.
 */
const PROTOCOL_FORMATS: ReadonlySet<string> = new Set(["HOT_TRAIL_2DAY", "IXS_3DAY"]);
export const NO_RACE_PROTOCOL_SENTENCE = "Préparation spécifique non définie pour ce format de course : NALYNT ne planifie pas de séance les jours qui la précèdent.";

function formatRaceDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const formatted = RACE_DATE.format(new Date(y!, m! - 1, d!));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function raceDetails(race: TodayRace): string[] {
  const format = translateRaceFormat(race.raceFormat);
  const priority = translateRacePriority(race.priority);
  return [formatRaceDate(race.startDate), race.location, format, priority ? `Priorité ${priority}` : null].filter((part): part is string => Boolean(part));
}

export function RaceBanner({ horizon, objective }: { horizon: RaceHorizon<TodayRace> | null; objective: string | null }) {
  if (!horizon && !objective) return null;

  let kicker: string;
  let big: string | null = null;
  let title: string;
  let details: string[] = [];
  let closing: string;
  let noProtocol = false;

  if (horizon?.kind === "countdown") {
    kicker = "Prochaine course";
    big = horizon.days === 1 ? "Demain" : `J-${horizon.days}`;
    title = horizon.race.eventName;
    details = raceDetails(horizon.race);
    closing = horizon.days === 1 ? "La course, c'est demain. Chaque décision compte." : `${horizon.days} jours avant ta course. Chaque décision compte.`;
    noProtocol = horizon.days <= 7 && !PROTOCOL_FORMATS.has(horizon.race.raceFormat ?? "");
  } else if (horizon?.kind === "ongoing") {
    kicker = "En course";
    big = `Jour ${horizon.day}`;
    title = horizon.race.eventName;
    details = raceDetails(horizon.race);
    closing = "Ton objectif reste. Ton plan s'adapte.";
  } else if (horizon?.kind === "horizon") {
    kicker = "Objectif de saison";
    title = horizon.race.eventName;
    details = raceDetails(horizon.race);
    closing = "Ton objectif reste. Ton plan s'adapte.";
  } else {
    kicker = "Ton objectif";
    title = objective!;
    closing = "Semaine en cours. Ton plan évolue avec ta réalité.";
  }

  return (
    <section aria-label={kicker} className="ux-enter ux-grain relative overflow-hidden border-l-2 border-gold py-1 pl-4" style={{ ["--d" as string]: "100ms" }}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">{kicker}</p>
      {big && <p className="mt-2 font-display text-6xl font-extrabold uppercase leading-[0.85] text-gold">{big}</p>}
      <p className={`font-display font-extrabold uppercase leading-[0.95] text-ink ${big ? "mt-2 text-3xl" : "mt-2 text-4xl"}`}>{title}</p>
      {details.length > 0 && <p className="mt-2 text-sm text-ink/75">{details.join(" · ")}</p>}
      <p className="mt-3 text-sm text-muted">{closing}</p>
      {noProtocol && (
        <p className="mt-2 text-sm text-ink/80" data-testid="no-race-protocol">
          {NO_RACE_PROTOCOL_SENTENCE}
        </p>
      )}
    </section>
  );
}
