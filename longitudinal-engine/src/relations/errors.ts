/**
 * Shared decision/timeline/execution structural-consistency error taxonomy —
 * moved out of `calculators/errors.ts` (M5_004) because M5_005's detector
 * layer needs the exact same invariants (decision lookup, AthleteDay
 * lookup, execution-relationship consistency), and `relations/**` must
 * never depend upward on `calculators/**` merely because these classes
 * happened to be declared there first. `calculators/errors.ts` re-exports
 * these five classes verbatim (same class identity, `instanceof` still
 * works) for backward compatibility — no downstream consumer of the old
 * `calculators/index.ts` surface breaks.
 *
 * Every class here represents a structural/contract violation — expected
 * non-observability is never modeled as an error, only as a value (see
 * relations/types.ts's ExecutionSignal). These classes are the converse:
 * input that contradicts an invariant this package (or the frozen
 * M5_001A/M5_003 DB contracts) already guarantees, surfaced loudly rather
 * than silently coerced — same philosophy as timeline/athleteScoping.ts's
 * TimelineAthleteMismatchError and timeline/decisionThread.ts's
 * OrphanedDecisionOutcomeError, which this module deliberately does not
 * duplicate.
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

/** M5_002B materializes exactly one AthleteDay per date in range — once a date is proven inside range, finding anything other than exactly one is a malformed timeline, never treated as "zero check-ins". */
export class InconsistentTimelineDayError extends Error {
  constructor(date: string, count: number) {
    super(`InconsistentTimelineDayError: expected exactly one AthleteDay for date ${date} within the covered range, found ${count}`);
    this.name = "InconsistentTimelineDayError";
  }
}

/**
 * Covers every same-day/reverse-link cardinality and bidirectional
 * agreement violation (see executionRelationship.ts's resolveExecutionRelationship
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
