/**
 * M5_004 calculator error taxonomy. Every class here represents a
 * structural/contract violation — expected non-observability (no check-in,
 * no linked session, an unresolved health flag, etc.) is never modeled as
 * an error, only as a value inside OutcomeSignals (see types.ts). These
 * classes are the exact converse: input that contradicts an invariant this
 * package (or the frozen M5_001A/M5_003 DB contracts) already guarantees,
 * surfaced loudly rather than silently coerced — same philosophy as
 * timeline/athleteScoping.ts's TimelineAthleteMismatchError and
 * timeline/decisionThread.ts's OrphanedDecisionOutcomeError, which this
 * module deliberately does not duplicate.
 *
 * `DecisionNotFoundInTimelineError`, `DuplicateDecisionThreadError`,
 * `InconsistentTimelineDayError`, `InconsistentExecutionLinkError`, and
 * `InconsistentExecutionDateError` moved to `relations/errors.ts` in
 * M5_005 (shared with the detector layer) and are re-exported here
 * verbatim — same class identity, `instanceof` still works — so the M5_004
 * import surface (`calculators/index.ts` and, transitively, the package
 * root) remains valid for every existing consumer.
 */
export {
  DecisionNotFoundInTimelineError,
  DuplicateDecisionThreadError,
  InconsistentTimelineDayError,
  InconsistentExecutionLinkError,
  InconsistentExecutionDateError,
} from "../relations/errors.js";

export class InvalidObservedThroughDateError extends Error {
  constructor(value: string, reason: string) {
    super(`InvalidObservedThroughDateError: observedThroughDate "${value}" is invalid — ${reason}`);
    this.name = "InvalidObservedThroughDateError";
  }
}

export class InvalidHorizonError extends Error {
  constructor(horizon: string) {
    super(`InvalidHorizonError: "${horizon}" is not a recognized DecisionOutcomeHorizon`);
    this.name = "InvalidHorizonError";
  }
}

/** Orchestration is expected to pre-filter immature horizons before ever invoking the calculator; this is the calculator's own belt-and-suspenders re-check, never relied upon as the sole gate. */
export class HorizonNotMatureError extends Error {
  constructor(decisionId: string, horizon: string, targetDate: string, observedThroughDate: string) {
    super(
      `HorizonNotMatureError: decision "${decisionId}" horizon ${horizon} targetDate ${targetDate} is after observedThroughDate ${observedThroughDate}`
    );
    this.name = "HorizonNotMatureError";
  }
}

/** targetDate falls outside the supplied timeline's materialized range — the data may simply not have been loaded. Never coerced into missing_observation. */
export class OutcomeTimelineCoverageError extends Error {
  constructor(targetDate: string, rangeFromDate: string, rangeToDate: string) {
    super(`OutcomeTimelineCoverageError: targetDate ${targetDate} is outside the supplied timeline range [${rangeFromDate}, ${rangeToDate}]`);
    this.name = "OutcomeTimelineCoverageError";
  }
}

export class InconsistentTargetCheckinError extends Error {
  constructor(targetDate: string, count: number) {
    super(`InconsistentTargetCheckinError: expected 0 or 1 check-in on ${targetDate}, found ${count}`);
    this.name = "InconsistentTargetCheckinError";
  }
}

/** An explicitly linked baseline check-in (decision.sourceCheckinId) whose own checkinDate differs from decision.decisionDate would produce a misleading delta from a different day — never computed. */
export class InconsistentBaselineCheckinError extends Error {
  constructor(decisionId: string, decisionDate: string, checkinId: string, checkinDate: string) {
    super(
      `InconsistentBaselineCheckinError: decision "${decisionId}" linkedSourceCheckin "${checkinId}" has checkinDate ${checkinDate}, expected exactly decisionDate ${decisionDate}`
    );
    this.name = "InconsistentBaselineCheckinError";
  }
}
