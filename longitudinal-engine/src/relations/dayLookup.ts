/**
 * Shared canonical AthleteDay resolution — one implementation reused by
 * calculators/decisionOutcomeSnapshot.ts (target-date lookup) and
 * executionRelationship.ts (decision-date lookup), so a caller can never
 * get a different structural-consistency guarantee depending on which
 * consumer happened to look the day up.
 */
import type { AthleteDay, AthleteTimeline } from "../timeline/types.js";
import { InconsistentTimelineDayError } from "./errors.js";

/** M5_002B materializes exactly one AthleteDay per date in range — once `date` is proven inside range, anything other than exactly one match is a malformed timeline, never silently treated as "zero check-ins". */
export function resolveUniqueDay(timeline: AthleteTimeline, date: string): AthleteDay {
  const matches = timeline.days.filter((d) => d.date === date);
  if (matches.length !== 1) throw new InconsistentTimelineDayError(date, matches.length);
  return matches[0]!;
}
