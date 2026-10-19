// SPORT-RACE-01P.3 (HPM 2026-10-19, proposition A approved) — what the rider declares about a race, kept apart:
// - the competition (circuit / organizer): `race_calendar.series`, a code from this closed list;
// - the event format a pre-event protocol exists for: `race_calendar.race_format`, derived from the competition
//   (Hot Trail Series → HOT_TRAIL_2DAY, iXS → IXS_3DAY, anything else → OTHER);
// - the duration: the dates (fixed only for the two protocol formats).
// A protocol applies only to a race explicitly identified as its series — the same rule as the engine
// (head-coach-engine/src/supabase/mapping/raceProtocolSelection.ts, equality locked by test): never from a duration,
// a name, a free-text series or a stored format alone. No generic protocol: any other competition has no specific
// preparation, and the rider is told so. Presentation and form rules only (no I/O).

export interface RaceSeriesOption {
  code: string;
  /** The option in the form. */
  label: string;
  /** The race_format the competition writes. */
  raceFormat: "HOT_TRAIL_2DAY" | "IXS_3DAY" | "OTHER";
  /** Fixed duration (days) of a protocol format; absent = free dates. */
  days?: number;
  /** Short name of its pre-event protocol, when it has one. */
  protocol?: string;
}

export const RACE_SERIES: readonly RaceSeriesOption[] = [
  { code: "HOT_TRAIL_SERIES", label: "Hot Trail Series (Swiss DH Cup) — 2 jours : entraînements et chrono, puis finale", raceFormat: "HOT_TRAIL_2DAY", days: 2, protocol: "Hot Trail" },
  { code: "IXS", label: "iXS (European Cup, DHC) — 3 jours, practice officielle la veille", raceFormat: "IXS_3DAY", days: 3, protocol: "iXS" },
  { code: "SWISS_OTHER", label: "Autre course en Suisse", raceFormat: "OTHER" },
  { code: "UCI_WORLD_CUP", label: "Coupe du monde UCI", raceFormat: "OTHER" },
  { code: "UCI_WORLD_CHAMPS", label: "Championnats du monde UCI", raceFormat: "OTHER" },
  { code: "FR_COUPE_DE_FRANCE_DH", label: "Coupe de France DH / DHI", raceFormat: "OTHER" },
  { code: "FR_CHAMPIONNAT_DE_FRANCE_DH", label: "Championnats de France DH / DHI", raceFormat: "OTHER" },
  { code: "FR_REGIONAL_DH", label: "Coupe ou championnat régional DH (France)", raceFormat: "OTHER" },
  { code: "FR_OTHER_DH", label: "Autre course DH en France", raceFormat: "OTHER" },
  { code: "OTHER", label: "Autre compétition", raceFormat: "OTHER" },
];

/** Short names for a stored race (lists, Today), never the raw code. */
const SERIES_SHORT_LABELS: Readonly<Record<string, string>> = {
  HOT_TRAIL_SERIES: "Hot Trail Series",
  IXS: "iXS",
  SWISS_OTHER: "Course en Suisse",
  UCI_WORLD_CUP: "Coupe du monde UCI",
  UCI_WORLD_CHAMPS: "Championnats du monde UCI",
  FR_COUPE_DE_FRANCE_DH: "Coupe de France DH / DHI",
  FR_CHAMPIONNAT_DE_FRANCE_DH: "Championnats de France DH / DHI",
  FR_REGIONAL_DH: "Course régionale DH (France)",
  FR_OTHER_DH: "Course DH en France",
  OTHER: "Autre compétition",
};

/** A race stored before this contract, without a competition: its old format, never presented as a protocol. */
const LEGACY_FORMAT_LABELS: Readonly<Record<string, string>> = {
  HOT_TRAIL_2DAY: "Course sur 2 jours — compétition à préciser",
  IXS_3DAY: "Course sur 3 jours — compétition à préciser",
  SWISS_CUP: "Swiss Cup",
  UCI_WC: "Coupe du monde UCI",
  UCI_WORLDS: "Championnats du monde UCI",
  OTHER: "Autre format",
};

export function seriesOption(code: string | null | undefined): RaceSeriesOption | undefined {
  return RACE_SERIES.find((option) => option.code === code);
}

/** The engine's rule (mirrored): the protocol this race gets, if any. */
export function raceProtocolOf(raceFormat: string | null | undefined, series: string | null | undefined): string | null {
  const option = seriesOption(series);
  return option?.protocol !== undefined && option.raceFormat === raceFormat ? option.protocol : null;
}

/** What the race is, for the rider: its competition, else a legacy format, else « Format non précisé ». */
export function competitionLabel(raceFormat: string | null | undefined, series: string | null | undefined): string {
  if (typeof series === "string" && series.trim() !== "") return SERIES_SHORT_LABELS[series] ?? series.trim();
  if (raceFormat === null || raceFormat === undefined) return "Format non précisé";
  return LEGACY_FORMAT_LABELS[raceFormat] ?? "Autre format";
}

export const SPECIFIC_PREPARATION_UNDEFINED = "Préparation spécifique non définie";

/** The line under a race: its protocol, or the honest absence of one. */
export function preparationLabel(raceFormat: string | null | undefined, series: string | null | undefined): string {
  const protocol = raceProtocolOf(raceFormat, series);
  return protocol ? `Préparation : protocole ${protocol}` : SPECIFIC_PREPARATION_UNDEFINED;
}
