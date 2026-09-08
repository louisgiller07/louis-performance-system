/**
 * Read-only access to `race_calendar`. See docs/05_DATA_MODEL.md
 * §race_calendar and docs/11_DECISION_LOG.md (2026-08-11 — Support courses
 * multi-jours) and docs/06_ARCHITECTURE.md §V0.3_002 (élargissement de la
 * fenêtre future).
 *
 * The actual pre/in-progress/post-event relevance decision is made by M1's
 * own `computeEventContext`/`hasOverlappingInProgressRaces`
 * (src/engine/eventContext.ts, frozen) — this repository does not
 * re-decide what counts as "upcoming" for EventContext. It only narrows
 * the SQL fetch to a superset covering ALL current consumers' documented
 * windows — M1's `PROVISIONAL_THRESHOLDS.event` (read-only import,
 * unchanged) AND V0.3_002B's `TECHNIQUE_POLICY.raceProximityWindowDays`
 * (C1.5, a domain-C policy — read-only import, distinct from and never
 * substituting the M1 PRE_EVENT window) — a pure query-efficiency bound,
 * not a business rule. `computeEventContext` itself still only classifies
 * races within its own 7-day PRE_EVENT window; the wider set of rows now
 * returned for V0.3_002B's Technique domain is otherwise inert to M1.
 *
 * V0.3_005B (NAL-007A) — `race_calendar.status` is coaching-relevance
 * metadata, filtered out entirely at THIS adapter boundary before a row
 * ever reaches `mapRaceCalendarRow`/`UpcomingRace` — M1 (frozen) still has
 * zero awareness of status, exactly as before. See
 * {@link isRaceCoachingRelevant} for the full truth table and
 * docs/11_DECISION_LOG.md (V0.3_005B) for the architecture decision.
 *
 * Note: `race_calendar` has no `race_phase` column in the current schema.
 * `UpcomingRace.race_phase` is optional and M1 already falls back to
 * `RACE_DAY_GENERIC` when absent (src/engine/eventContext.ts) — so this
 * field is simply never populated here, not fabricated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVISIONAL_THRESHOLDS } from "../../engine/provisionalThresholds.js";
import { TECHNIQUE_POLICY } from "../../config/techniquePolicy.js";
import { assertNoSupabaseError } from "./supabaseError.js";

export type RaceCalendarRawRow = Record<string, unknown>;

const KNOWN_RACE_STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "registered",
  "confirmed",
  "completed",
  "cancelled",
  "skipped",
]);

export class InvalidRaceCalendarStatusError extends Error {
  constructor(value: unknown) {
    super(`race_calendar.status is missing or not a recognized race_status value: ${JSON.stringify(value)}`);
    this.name = "InvalidRaceCalendarStatusError";
  }
}

/**
 * V0.3_005B (NAL-007A) — coaching-relevance truth table for `race_calendar.status`:
 *
 * | status     | PRE_EVENT | IN_PROGRESS | POST_EVENT |
 * |------------|-----------|-------------|------------|
 * | planned    | INCLUDE   | INCLUDE     | INCLUDE    |
 * | registered | INCLUDE   | INCLUDE     | INCLUDE    |
 * | confirmed  | INCLUDE   | INCLUDE     | INCLUDE    |
 * | completed  | EXCLUDE   | EXCLUDE     | INCLUDE    |
 * | cancelled  | EXCLUDE   | EXCLUDE     | EXCLUDE    |
 * | skipped    | EXCLUDE   | EXCLUDE     | EXCLUDE    |
 *
 * `cancelled`/`skipped` are excluded unconditionally — nothing to taper
 * for, nothing in progress, nothing to recover from. `completed` is
 * excluded only while still date-future-or-present (`endDate >= today`,
 * covering PRE_EVENT and IN_PROGRESS) and included once genuinely past
 * (`endDate < today`, POST_EVENT) — `completed` must NOT gate POST_EVENT
 * on its own, because no application code currently ever transitions a row
 * to `completed` (confirmed by full-codebase audit, V0.3_005B/NAL-007A
 * preflight): requiring it would silently disable POST_EVENT recovery for
 * every real race. `planned`/`registered`/`confirmed` are always included
 * — the existing M1 date logic (`computeEventContext`, unchanged) is what
 * actually decides PRE_EVENT/IN_PROGRESS/POST_EVENT/irrelevant from there.
 *
 * A status outside the known `race_status` enum values throws rather than
 * being silently treated as active or inactive — the DB enum already
 * constrains real values, so this can only happen from a genuinely
 * malformed row.
 */
export function isRaceCoachingRelevant(status: unknown, endDate: string, today: string): boolean {
  if (typeof status !== "string" || !KNOWN_RACE_STATUSES.has(status)) {
    throw new InvalidRaceCalendarStatusError(status);
  }
  if (status === "cancelled" || status === "skipped") return false;
  if (status === "completed") return endDate < today;
  return true; // planned | registered | confirmed
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches `race_calendar` rows whose [start_date, end_date] window
 * overlaps [today - postEventWindowDays, today + max(preEventWindowDays,
 * raceProximityWindowDays)] — a superset covering both M1's own
 * EventContext classifier and V0.3_002B's Technique domain (C1.5).
 *
 * V0.3_005B (NAL-007A) — every returned row has already passed
 * {@link isRaceCoachingRelevant} against this same `today` (the exact
 * target date `buildRawContext` is evaluating, never a second clock/date
 * source). `status` itself is never returned — it is consumed and
 * discarded here, before `mapRaceCalendarRow`/`UpcomingRace` ever see the
 * row, so M1 remains exactly as status-unaware as before.
 */
export async function getRacesInWindow(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<RaceCalendarRawRow[]> {
  const windowStart = addDays(today, -PROVISIONAL_THRESHOLDS.event.postEventWindowDays);
  const windowEnd = addDays(
    today,
    Math.max(PROVISIONAL_THRESHOLDS.event.preEventWindowDays, TECHNIQUE_POLICY.raceProximityWindowDays)
  );

  const { data, error } = await client
    .from("race_calendar")
    .select("event_name, start_date, end_date, priority, race_format, status")
    .eq("athlete_id", athleteId)
    .lte("start_date", windowEnd)
    .gte("end_date", windowStart);

  assertNoSupabaseError(error, "race_calendar");

  // `status` is consumed for this filter only — mapRaceCalendarRow.ts
  // explicitly whitelists the fields it reads and never spreads a row
  // wholesale, so leaving `status` present on the returned raw row is
  // harmless: it simply reaches no further than this function's caller,
  // which discards it the same way.
  return ((data ?? []) as RaceCalendarRawRow[]).filter((row) =>
    isRaceCoachingRelevant(row.status, row.end_date as string, today)
  );
}
