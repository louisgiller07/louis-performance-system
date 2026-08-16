/**
 * `race_calendar` row → M1 `UpcomingRace`. See docs/05_DATA_MODEL.md
 * §race_calendar and docs/11_DECISION_LOG.md (M2 read-path review —
 * race_format contract).
 *
 * `race_format` is nullable in the DB (no `DEFAULT`, no `NOT NULL`) but
 * required (non-optional) on M1's frozen `UpcomingRace`. Decided contract:
 *
 * - A known, non-null `race_format` → mapped verbatim, no warning.
 * - `race_format IS NULL` → mapped to `"OTHER"` **and an explicit warning
 *   is emitted**: the race stays present in the context (no data lost),
 *   `race.race_format` is only ever used in src/rules/raceProtocol.ts as a
 *   lookup key into `PRE_EVENT_TABLES` (`Partial<Record<RaceFormat, ...>>`,
 *   covering only `HOT_TRAIL_2DAY`/`IXS_3DAY`) where `"OTHER"` triggers no
 *   specialized T-X table — the same well-defined "no T-X table" outcome
 *   as any other unlisted format — but the warning preserves the fact that
 *   the source value was genuinely unknown rather than silently discarding
 *   that information.
 * - A non-null value that is *not* a recognized `RaceFormat` → rejected
 *   with {@link InvalidRaceCalendarRowError}. Unlike the NULL case, an
 *   unrecognized non-null string is not "absent data reconciled at the
 *   boundary" — it is a value the schema/vocabulary doesn't account for,
 *   and is never silently folded into `"OTHER"`.
 *
 * `race_phase` has no DB column at all (see raceCalendarRepo.ts) and is
 * therefore never populated — M1 already defaults it to
 * `RACE_DAY_GENERIC` internally (src/engine/eventContext.ts) when absent.
 * No change here (docs/11_DECISION_LOG.md).
 */
import type { RaceFormat, RacePriority, UpcomingRace } from "../../types/index.js";
import type { RaceCalendarRawRow } from "../repositories/raceCalendarRepo.js";

const RACE_PRIORITIES: ReadonlySet<string> = new Set(["A_PLUS", "A", "B", "C"]);
const RACE_FORMATS: ReadonlySet<string> = new Set([
  "HOT_TRAIL_2DAY",
  "IXS_3DAY",
  "SWISS_CUP",
  "UCI_WC",
  "UCI_WORLDS",
  "OTHER",
]);

export class InvalidRaceCalendarRowError extends Error {
  constructor(reason: string, value: unknown) {
    super(`Invalid race_calendar row: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidRaceCalendarRowError";
  }
}

export interface RaceCalendarMapping {
  race: UpcomingRace;
  /** Non-empty only when race_format was NULL and had to be reconciled to "OTHER" — see module doc. */
  warnings: string[];
}

/**
 * Maps a `race_calendar` row to `{ race, warnings }`. Throws
 * {@link InvalidRaceCalendarRowError} for a missing/unrecognized required
 * field, including a non-null `race_format` that isn't a known
 * `RaceFormat`. A NULL `race_format` is the one case reconciled to
 * `"OTHER"`, with an explicit warning rather than a silent conversion.
 */
export function mapRaceCalendarRow(row: RaceCalendarRawRow): RaceCalendarMapping {
  if (typeof row.event_name !== "string") {
    throw new InvalidRaceCalendarRowError("event_name is missing or not a string", row);
  }
  if (typeof row.start_date !== "string") {
    throw new InvalidRaceCalendarRowError("start_date is missing or not a string", row);
  }
  if (typeof row.end_date !== "string") {
    throw new InvalidRaceCalendarRowError("end_date is missing or not a string", row);
  }
  if (typeof row.priority !== "string" || !RACE_PRIORITIES.has(row.priority)) {
    throw new InvalidRaceCalendarRowError("priority is missing or unknown", row);
  }

  const warnings: string[] = [];
  let race_format: RaceFormat;

  if (row.race_format === null || row.race_format === undefined) {
    race_format = "OTHER";
    warnings.push(
      `race_calendar row "${row.event_name}" has race_format = NULL — mapped to "OTHER" (no T-X table ` +
        "triggered by this format either way). See docs/05_DATA_MODEL.md §race_calendar and " +
        "docs/11_DECISION_LOG.md."
    );
  } else if (typeof row.race_format === "string" && RACE_FORMATS.has(row.race_format)) {
    race_format = row.race_format as RaceFormat;
  } else {
    throw new InvalidRaceCalendarRowError("race_format is not a recognized RaceFormat", row);
  }

  return {
    race: {
      event_name: row.event_name,
      event_start: row.start_date,
      event_end: row.end_date,
      priority: row.priority as RacePriority,
      race_format,
    },
    warnings,
  };
}
