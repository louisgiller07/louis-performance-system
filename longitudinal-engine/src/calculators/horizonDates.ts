/**
 * Pure horizon date-math — the single source of truth for "what calendar
 * date does this horizon target", reused identically by the calculator and
 * (for its own pre-filtering) the orchestrator. Reuses range.ts's own
 * UTC-safe parse/format primitives rather than reimplementing date
 * arithmetic — see range.ts's export doc.
 */
import type { DecisionOutcomeHorizon } from "../types/sources.js";
import { InvalidDateRangeError, MS_PER_DAY, formatUtcMs, parseCanonicalDateUtc } from "../timeline/range.js";
import { InvalidHorizonError, InvalidObservedThroughDateError } from "./errors.js";

/** Runtime-validated (never trusts the TS type alone — this is public calculator input, see decisionOutcomeSnapshot.ts). */
function horizonOffsetDays(horizon: DecisionOutcomeHorizon): number {
  switch (horizon) {
    case "J_PLUS_1":
      return 1;
    case "J_PLUS_3":
      return 3;
    case "J_PLUS_7":
      return 7;
    default:
      throw new InvalidHorizonError(String(horizon));
  }
}

/** decisionDate + {1,3,7} calendar days, UTC-safe. Throws InvalidHorizonError for an unrecognized horizon, or lets a malformed decisionDate's InvalidDateRangeError propagate (decisionDate always comes from an already-validated DecisionSource, never raw external input). */
export function targetDateForHorizon(decisionDate: string, horizon: DecisionOutcomeHorizon): string {
  const offsetDays = horizonOffsetDays(horizon);
  const decisionMs = parseCanonicalDateUtc(decisionDate, "decisionDate");
  return formatUtcMs(decisionMs + offsetDays * MS_PER_DAY);
}

/**
 * Validates observedThroughDate as a genuine, well-formed calendar date —
 * this is public runtime input (unlike decisionDate, which is always
 * already-validated source data), so it gets its own deterministic,
 * package-owned rejection rather than letting range.ts's
 * InvalidDateRangeError (a different domain's error identity) leak through.
 */
export function validateObservedThroughDate(value: string): void {
  try {
    parseCanonicalDateUtc(value, "observedThroughDate");
  } catch (err) {
    const reason = err instanceof InvalidDateRangeError ? err.message : err instanceof Error ? err.message : String(err);
    throw new InvalidObservedThroughDateError(value, reason);
  }
}

/**
 * Both arguments are already-canonical "YYYY-MM-DD" strings; plain
 * lexicographic comparison equals calendar comparison — same convention as
 * timeline/healthContext.ts's isFlagActiveOnDay.
 */
export function isHorizonMature(targetDate: string, observedThroughDate: string): boolean {
  return targetDate <= observedThroughDate;
}
