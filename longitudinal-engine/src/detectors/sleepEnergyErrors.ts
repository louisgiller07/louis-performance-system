/**
 * Structural error taxonomy owned by the sleep-energy detector — distinct
 * from detectors/errors.ts (M5_005-owned) and relations/errors.ts (shared
 * decision/execution invariants): this detector consumes checkins, not
 * decisions/executions, so it needs its own structural vocabulary. Same
 * philosophy as every other error class in this package: a contract
 * violation the caller's timeline itself guarantees should never happen,
 * surfaced loudly rather than silently coerced into a NoEvidence result.
 */

/** `evaluationCheckinId` does not match any checkin row anywhere in the supplied timeline. */
export class CheckinNotFoundInTimelineError extends Error {
  constructor(evaluationCheckinId: string) {
    super(`CheckinNotFoundInTimelineError: no checkin found for evaluationCheckinId "${evaluationCheckinId}" in the supplied timeline`);
    this.name = "CheckinNotFoundInTimelineError";
  }
}

/**
 * The supplied timeline does not cover the full [C-60d, C] window this
 * detector requires — checked BEFORE any baseline density/variance logic,
 * and deliberately NOT modeled as NoEvidence: an under-loaded timeline is a
 * caller contract violation (the caller must load enough history before
 * calling this detector), not an observed absence of correlation.
 */
export class InsufficientTimelineCoverageError extends Error {
  constructor(requiredFromDate: string, requiredToDate: string, actualFromDate: string, actualToDate: string) {
    super(
      `InsufficientTimelineCoverageError: detector requires timeline.range to cover [${requiredFromDate}, ${requiredToDate}], but the supplied timeline only covers [${actualFromDate}, ${actualToDate}]`
    );
    this.name = "InsufficientTimelineCoverageError";
  }
}

/**
 * More than one checkin row shares the same calendar date within the
 * detector's consumed [C-60, C] range. The real DB enforces
 * UNIQUE(athlete_id, checkin_date), so this should never happen against a
 * real Supabase-sourced timeline — kept as defense in depth against a
 * malformed synthetic timeline (e.g. in tests), same philosophy as
 * InconsistentTimelineDayError (relations/errors.ts) for AthleteDay itself.
 */
export class DuplicateCheckinDateError extends Error {
  constructor(date: string, count: number) {
    super(`DuplicateCheckinDateError: ${count} checkins found for date "${date}" — expected at most one (UNIQUE(athlete_id, checkin_date) in the real schema)`);
    this.name = "DuplicateCheckinDateError";
  }
}
