// REV-016b — athlete-facing labels for the race identifiers the frozen M1
// engine interpolates into its race explanations (head-coach-engine
// types/context.ts RaceFormat / RacePhase, race priority). Validated wording:
// official race names kept, generic formats translated. Any value missing
// here returns `null`, and callers then keep the engine's original sentence
// rather than guessing.

export const RACE_FORMAT_LABELS: Readonly<Record<string, string>> = {
  IXS_3DAY: "iXS, 3 jours",
  HOT_TRAIL_2DAY: "Hot Trail, 2 jours",
  SWISS_CUP: "Swiss Cup",
  UCI_WC: "Coupe du monde UCI",
  UCI_WORLDS: "Championnats du monde UCI",
};

export const RACE_PRIORITY_LABELS: Readonly<Record<string, string>> = {
  A_PLUS: "A+",
  A: "A",
  B: "B",
  C: "C",
};

/** In-progress race phases (RacePhase minus PRE_EVENT / POST_EVENT, which never describe a race in progress). */
export const RACE_PHASE_LABELS: Readonly<Record<string, string>> = {
  TRACKWALK: "reconnaissance",
  PRACTICE: "entraînements",
  PRACTICE_TIMED: "entraînements chronométrés",
  QUALI: "qualifications",
  FINAL: "finale",
  RACE_DAY_GENERIC: "jour de course",
};

/** Own keys only — an inherited name ("toString", "constructor") never matches. */
function ownLabel(table: Readonly<Record<string, string>>, value: unknown): string | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value) ? table[value]! : null;
}

export function translateRaceFormat(format: unknown): string | null {
  return ownLabel(RACE_FORMAT_LABELS, format);
}

export function translateRacePriority(priority: unknown): string | null {
  return ownLabel(RACE_PRIORITY_LABELS, priority);
}

export function translateRacePhase(phase: unknown): string | null {
  return ownLabel(RACE_PHASE_LABELS, phase);
}
