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
    .select("event_name, start_date, end_date, priority, race_format")
    .eq("athlete_id", athleteId)
    .lte("start_date", windowEnd)
    .gte("end_date", windowStart);

  assertNoSupabaseError(error, "race_calendar");
  return (data ?? []) as RaceCalendarRawRow[];
}
