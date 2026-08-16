/**
 * Read-only access to `race_calendar`. See docs/05_DATA_MODEL.md
 * §race_calendar and docs/11_DECISION_LOG.md (2026-08-11 — Support courses
 * multi-jours).
 *
 * The actual pre/in-progress/post-event relevance decision is made by M1's
 * own `computeEventContext`/`hasOverlappingInProgressRaces`
 * (src/engine/eventContext.ts, frozen) — this repository does not
 * re-decide what counts as "upcoming". It only narrows the SQL fetch to a
 * superset covering M1's own documented windows, reusing M1's actual
 * `PROVISIONAL_THRESHOLDS.event` constants (read-only import) rather than
 * re-declaring the day counts here — a pure query-efficiency bound, not a
 * business rule.
 *
 * Note: `race_calendar` has no `race_phase` column in the current schema.
 * `UpcomingRace.race_phase` is optional and M1 already falls back to
 * `RACE_DAY_GENERIC` when absent (src/engine/eventContext.ts) — so this
 * field is simply never populated here, not fabricated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVISIONAL_THRESHOLDS } from "../../engine/provisionalThresholds.js";
import { assertNoSupabaseError } from "./supabaseError.js";

export type RaceCalendarRawRow = Record<string, unknown>;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches `race_calendar` rows whose [start_date, end_date] window
 * overlaps [today - postEventWindowDays, today + preEventWindowDays] —
 * a superset of what M1's own classifier considers relevant for `today`.
 */
export async function getRacesInWindow(
  client: SupabaseClient,
  athleteId: string,
  today: string
): Promise<RaceCalendarRawRow[]> {
  const windowStart = addDays(today, -PROVISIONAL_THRESHOLDS.event.postEventWindowDays);
  const windowEnd = addDays(today, PROVISIONAL_THRESHOLDS.event.preEventWindowDays);

  const { data, error } = await client
    .from("race_calendar")
    .select("event_name, start_date, end_date, priority, race_format")
    .eq("athlete_id", athleteId)
    .lte("start_date", windowEnd)
    .gte("end_date", windowStart);

  assertNoSupabaseError(error, "race_calendar");
  return (data ?? []) as RaceCalendarRawRow[];
}
