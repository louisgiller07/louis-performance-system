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
 */

export class DecisionNotFoundInTimelineError extends Error {
  constructor(decisionId: string) {
    super(`DecisionNotFoundInTimelineError: no DecisionThread found for decisionId "${decisionId}" in the supplied timeline`);
    this.name = "DecisionNotFoundInTimelineError";
  }
}

/** Structurally should never happen (decision.id is a DB primary key, and M5_002B builds exactly one thread per decision row) — kept as defense in depth, never resolved by picking one. */
export class DuplicateDecisionThreadError extends Error {
  constructor(decisionId: string, count: number) {
    super(`DuplicateDecisionThreadError: ${count} DecisionThreads found for decisionId "${decisionId}" — expected exactly one`);
    this.name = "DuplicateDecisionThreadError";
  }
}

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

/** M5_002B materializes exactly one AthleteDay per date in range — once a date is proven inside range, finding anything other than exactly one is a malformed timeline, never treated as "zero check-ins". */
export class InconsistentTimelineDayError extends Error {
  constructor(date: string, count: number) {
    super(`InconsistentTimelineDayError: expected exactly one AthleteDay for date ${date} within the covered range, found ${count}`);
    this.name = "InconsistentTimelineDayError";
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

/**
 * Covers every same-day/reverse-link cardinality and bidirectional
 * agreement violation (see decisionOutcomeSnapshot.ts's resolveExecution
 * for the exact truth table) — a single class, distinguished by its
 * message, rather than one class per violated invariant: all of them are
 * the same underlying fact ("the two canonical views of this decision's
 * execution relationship disagree"), never repaired by picking one view
 * over the other.
 */
export class InconsistentExecutionLinkError extends Error {
  constructor(reason: string) {
    super(`InconsistentExecutionLinkError: ${reason}`);
    this.name = "InconsistentExecutionLinkError";
  }
}

/** Violates the frozen M5_001A/M5_003 contract that an explicitly linked completed_sessions row always has session_date === decisions.decision_date (enforced by completed-session/index.ts's own preflight). */
export class InconsistentExecutionDateError extends Error {
  constructor(decisionId: string, decisionDate: string, sessionId: string, sessionDate: string) {
    super(
      `InconsistentExecutionDateError: completed session "${sessionId}" is explicitly linked to decision "${decisionId}" (decisionDate ${decisionDate}) but has sessionDate ${sessionDate}`
    );
    this.name = "InconsistentExecutionDateError";
  }
}
