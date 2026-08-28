/**
 * V0.3_001A — the smallest glue needed to go from "an authenticated client
 * + an athlete" to a real, compact `AthleteTimeline`, reusing the existing
 * closed 5-method `LongitudinalSourceAdapter` interface exactly as-is (no
 * interface change) and the existing, unmodified `buildTimeline`.
 *
 * Two DIFFERENT ranges are involved, per docs/06_ARCHITECTURE.md
 * §V0.3_001 (see runtimeRanges.ts's own doc for the full record):
 *   1. the LONGITUDINAL SOURCE QUERY bounds — `{DOMAIN_HISTORY_FLOOR_DATE,
 *      longitudinalProcessingDate}` — a cheap `.gte()/.lte()` WHERE-clause
 *      bound passed to the 5 adapter reads; Postgres returns only the
 *      actual matching rows, it never enumerates calendar dates. Bounding
 *      the upper end at `longitudinalProcessingDate` (never a far future
 *      date) also structurally EXCLUDES any future-dated source row from
 *      ever entering the timeline at all — no separate future-date filter
 *      is needed anywhere downstream.
 *   2. the LONGITUDINAL TIMELINE RANGE — derived from the MINIMUM date
 *      actually present across the 5 fetched pools, then padded BACKWARD
 *      by the largest lookback window any existing detector structurally
 *      requires (see `LOOKBACK_PADDING_DAYS` below) up to
 *      `longitudinalProcessingDate`. THIS compact range, and only this
 *      range, is ever passed to `buildTimeline` — never
 *      `INSIGHT_AGGREGATION_RANGE`.
 *
 * Why the padding is required (found empirically during implementation,
 * not merely theorized): `sleep_quality_to_same_day_energy_correlation`
 * and `pain_persistence_across_recent_checkins` both throw
 * `InsufficientTimelineCoverageError` when `timeline.range.fromDate`
 * doesn't structurally reach back far enough to cover their own lookback
 * window — this is a STRUCTURAL check on the timeline's own declared
 * range, independent of whether real data exists in that window. Using
 * the raw MIN-of-actual-rows as `fromDate` (with no padding) means the
 * very FIRST evaluation unit in any athlete's history always fails this
 * check, since a brand-new history structurally cannot have 60 days of
 * timeline coverage before its own first row. The fix reuses each
 * detector's own already-exported public lookback constant
 * (`SLEEP_ENERGY_BASELINE_WINDOW_DAYS`, `PAIN_PERSISTENCE_LOOKBACK_DAYS`)
 * purely for RANGE PADDING — never detection/classification logic, so
 * this remains "one implementation of the domain rules," not a second
 * one. `recommendation_vs_actual_execution` has no lookback requirement
 * at all (same-day only), so it contributes no padding.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AthleteTimeline } from "../timeline/types.js";
import { buildTimeline } from "../timeline/buildTimeline.js";
import { MS_PER_DAY, formatUtcMs, parseCanonicalDateUtc } from "../timeline/range.js";
import type { DateRange } from "../types/adapter.js";
import { SLEEP_ENERGY_BASELINE_WINDOW_DAYS } from "../detectors/sleepEnergyConstants.js";
import { PAIN_PERSISTENCE_LOOKBACK_DAYS } from "../detectors/index.js";
import { SupabaseLongitudinalSourceAdapter } from "./adapter.js";
import { DOMAIN_HISTORY_FLOOR_DATE } from "./runtimeRanges.js";

/** The largest lookback window any existing detector structurally requires — see module doc above. Update this if a future detector introduces a larger lookback. */
const LOOKBACK_PADDING_DAYS = Math.max(SLEEP_ENERGY_BASELINE_WINDOW_DAYS, PAIN_PERSISTENCE_LOOKBACK_DAYS);

export interface AssembleAthleteTimelineParams {
  /** Deliberately a plain SupabaseClient, not admin-typed — least privilege: the caller passes an authenticated (RLS-scoped) client for V0.3_001A's refresh-longitudinal, per docs/06_ARCHITECTURE.md §V0.3_001. */
  readonly client: SupabaseClient;
  readonly athleteId: string;
  readonly longitudinalProcessingDate: string;
}

function minDate(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  let min = dates[0]!;
  for (const d of dates) {
    if (d < min) min = d;
  }
  return min;
}

export async function assembleAthleteTimeline(params: AssembleAthleteTimelineParams): Promise<AthleteTimeline> {
  const { client, athleteId, longitudinalProcessingDate } = params;
  const adapter = new SupabaseLongitudinalSourceAdapter(client);

  const sourceQueryRange: DateRange = { fromDate: DOMAIN_HISTORY_FLOOR_DATE, toDate: longitudinalProcessingDate };

  const [checkins, decisions, completedSessions, outcomes, healthFlags] = await Promise.all([
    adapter.getDailyCheckins(athleteId, sourceQueryRange),
    adapter.getDecisions(athleteId, sourceQueryRange),
    adapter.getCompletedSessions(athleteId, sourceQueryRange),
    adapter.getDecisionOutcomes(athleteId, sourceQueryRange),
    adapter.getHealthFlags(athleteId, sourceQueryRange),
  ]);

  const earliestSourceDate = minDate([
    ...checkins.map((c) => c.checkinDate),
    ...decisions.map((d) => d.decisionDate),
    ...completedSessions.map((s) => s.sessionDate),
    ...healthFlags.map((f) => f.flagDate),
    // decision_outcomes is deliberately excluded: its own date semantics are already bounded by
    // decisions.decision_date (see LongitudinalSourceAdapter.getDecisionOutcomes's own doc), so it can
    // never independently push the minimum earlier than what `decisions` already contributes.
  ]);

  // No padding when there is no real source data at all (a brand-new athlete): the range
  // collapses to the single day {longitudinalProcessingDate, longitudinalProcessingDate},
  // never an artificial 60-day-back window with nothing in it.
  let timelineFromDate = earliestSourceDate ?? longitudinalProcessingDate;
  if (earliestSourceDate !== null) {
    const paddedFromMs = parseCanonicalDateUtc(earliestSourceDate, "earliestSourceDate") - LOOKBACK_PADDING_DAYS * MS_PER_DAY;
    const floorMs = parseCanonicalDateUtc(DOMAIN_HISTORY_FLOOR_DATE, "DOMAIN_HISTORY_FLOOR_DATE");
    timelineFromDate = formatUtcMs(Math.max(paddedFromMs, floorMs));
  }

  const timelineRange: DateRange = {
    fromDate: timelineFromDate,
    toDate: longitudinalProcessingDate,
  };

  return buildTimeline({
    athleteId,
    range: timelineRange,
    sources: { checkins, decisions, completedSessions, outcomes, healthFlags },
  });
}
