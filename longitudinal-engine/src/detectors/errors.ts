/**
 * Detector-owned error taxonomy for M5_005's recommendation-vs-actual
 * execution detector. Shared decision/execution structural errors
 * (DecisionNotFoundInTimelineError, DuplicateDecisionThreadError,
 * InconsistentExecutionLinkError, InconsistentExecutionDateError,
 * InconsistentTimelineDayError) are deliberately NOT redefined here — the
 * detector propagates them unwrapped, straight from `relations/**`, so
 * there is exactly one identity for each of those invariants across the
 * whole package (see recommendationVsActualExecution.ts).
 */
import type { CompletionStatus, DbSessionType } from "../types/sources.js";

/**
 * `timeline.athleteId` (the caller-declared scope) disagrees with the
 * resolved decision's own `athleteId`. Structurally should never happen —
 * M5_002B's own `assertAthleteScoped` already guarantees every decision in
 * `timeline.decisionThreads` belongs to `timeline.athleteId` — kept as
 * defense in depth, same philosophy as every other belt-and-suspenders
 * check in this package.
 */
export class AthleteScopeMismatchError extends Error {
  constructor(decisionId: string, decisionAthleteId: string, timelineAthleteId: string) {
    super(
      `AthleteScopeMismatchError: decision "${decisionId}" belongs to athlete "${decisionAthleteId}", but the supplied timeline is scoped to athlete "${timelineAthleteId}"`
    );
    this.name = "AthleteScopeMismatchError";
  }
}

/**
 * An explicit execution relationship exists (ExecutionSignal.state ===
 * "explicit") with `completion_status` of `done`/`partial`/`skipped`, but
 * `sessionType !== decision.finalSession` — under the classification matrix
 * (M5_005 lock, point 13) this is a structural inconsistency, never
 * evidence: for these three statuses the athlete is reporting on the
 * *recommended* session, so a type mismatch means the source data itself
 * is contradictory, not that the recommendation was "not followed" (that
 * is exactly what `replaced` exists to express, and a type mismatch is
 * always valid there — see the detector's own classification switch).
 */
export class CompletionStatusTypeMismatchError extends Error {
  constructor(
    decisionId: string,
    completedSessionId: string,
    completionStatus: CompletionStatus,
    recommendedSessionType: DbSessionType,
    actualSessionType: DbSessionType
  ) {
    super(
      `CompletionStatusTypeMismatchError: decision "${decisionId}" completed_session "${completedSessionId}" has completion_status "${completionStatus}" but sessionType "${actualSessionType}" does not match recommended finalSession "${recommendedSessionType}" — a type mismatch is only ever valid for completion_status "replaced"`
    );
    this.name = "CompletionStatusTypeMismatchError";
  }
}
