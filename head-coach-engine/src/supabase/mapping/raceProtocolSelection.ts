/**
 * SPORT-RACE-01P.3 (HPM 2026-10-19, proposition A approved) — the ONE rule that decides whether a race gets a
 * pre-event protocol, shared by M1's daily context (mapRaceCalendarRow) and the V2 plan snapshot
 * (buildPlanInputSnapshotV2), so both always select the same protocol.
 *
 * A race_calendar row distinguishes three things:
 * - the circuit / organizer: `series`, a closed code written by the race form (RACE_SERIES_CODES);
 * - the event format a T-X protocol exists for: `race_format` (`HOT_TRAIL_2DAY`, `IXS_3DAY`);
 * - the duration: `start_date` … `end_date`.
 * A protocol applies ONLY when the rider explicitly identified the race as the series the protocol was written for
 * (Hot Trail Series → HOT_TRAIL_2DAY, iXS → IXS_3DAY), never from a duration, a name, a free-text series or a
 * format value alone. A row stored before this contract with `HOT_TRAIL_2DAY` / `IXS_3DAY` but without that code
 * (the old « Course sur 2 / 3 jours » choice, « 2 jours » preselected) is ambiguous: no protocol (`OTHER`), with an
 * explicit warning — the rider confirms the competition to get it back. Nothing else changes: `SWISS_CUP`,
 * `UCI_WC`, `UCI_WORLDS` and `OTHER` never had a protocol; NULL stays `OTHER` with its warning. M1 (frozen) is
 * unchanged: it receives the selected format.
 */
import type { RaceFormat } from "../../types/index.js";

/** The circuits the race form offers (closed list; `series` holds the code, never a label). */
export const RACE_SERIES_CODES = [
  "HOT_TRAIL_SERIES",
  "IXS",
  "SWISS_OTHER",
  "UCI_WORLD_CUP",
  "UCI_WORLD_CHAMPS",
  "FR_COUPE_DE_FRANCE_DH",
  "FR_CHAMPIONNAT_DE_FRANCE_DH",
  "FR_REGIONAL_DH",
  "FR_OTHER_DH",
  "OTHER",
] as const;
export type RaceSeriesCode = (typeof RACE_SERIES_CODES)[number];

/** The only series a pre-event protocol exists for, and its format (docs/04 §3). */
export const SERIES_PROTOCOL_FORMAT: Readonly<Partial<Record<RaceSeriesCode, RaceFormat>>> = {
  HOT_TRAIL_SERIES: "HOT_TRAIL_2DAY",
  IXS: "IXS_3DAY",
};

const PROTOCOL_FORMATS: ReadonlySet<string> = new Set(["HOT_TRAIL_2DAY", "IXS_3DAY"]);

export interface RaceProtocolSelection {
  /** The format M1 and the V2 planner use: a protocol format only when explicitly identified. */
  race_format: RaceFormat;
  /** True when the race gets its series' pre-event protocol. */
  protocol: boolean;
  /** Why a stored format was not used as is (legacy / NULL). */
  warning?: string;
}

/**
 * `raceFormat` is a known `RaceFormat` or null (callers validate the enum first); `series` is the raw column.
 */
export function selectRaceProtocolFormat(eventName: string, raceFormat: RaceFormat | null, series: unknown): RaceProtocolSelection {
  if (raceFormat === null) {
    return {
      race_format: "OTHER",
      protocol: false,
      warning:
        `race_calendar row "${eventName}" has race_format = NULL — mapped to "OTHER" (no T-X table ` +
        "triggered by this format either way). See docs/05_DATA_MODEL.md §race_calendar and docs/11_DECISION_LOG.md.",
    };
  }
  if (!PROTOCOL_FORMATS.has(raceFormat)) return { race_format: raceFormat, protocol: false };
  if (typeof series === "string" && SERIES_PROTOCOL_FORMAT[series as RaceSeriesCode] === raceFormat) {
    return { race_format: raceFormat, protocol: true };
  }
  return {
    race_format: "OTHER",
    protocol: false,
    warning:
      `race_calendar row "${eventName}" has race_format = ${raceFormat} without the explicit series it was written for ` +
      `(series = ${JSON.stringify(series ?? null)}) — no pre-event protocol, mapped to "OTHER" (SPORT-RACE-01P.3: never ` +
      "a protocol from a duration or an unconfirmed format). See docs/05_DATA_MODEL.md §race_calendar.",
  };
}
