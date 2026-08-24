/**
 * Shared, pure decision-execution relationship resolver — extracted from
 * calculators/decisionOutcomeSnapshot.ts (M5_004) so both the M5_004
 * calculator and the M5_005 detector layer consume exactly one
 * implementation of "what is this decision's execution relationship,
 * really" (see docs/11_DECISION_LOG.md, M5_005 — shared resolver
 * extraction). No behavior changed versus the original M5_004
 * `resolveExecution`: same lookups, same cardinality/consistency checks,
 * same four canonical states, same error classes — only the module
 * boundary moved.
 *
 * Owns ALL of: the decision lookup required for execution, the
 * decision-date AthleteDay lookup, same-day completed-session cardinality,
 * reverse linked-session cardinality, the explicit-link date invariant, the
 * sameDay<->reverseLink bidirectional consistency check, and the canonical
 * four-state ExecutionSignal classification. No other module may
 * re-implement any part of this.
 */
import type { AthleteTimeline, CompletedSessionOnDay, DecisionThread } from "../timeline/types.js";
import { resolveDecisionThreadById } from "./decisionLookup.js";
import { resolveUniqueDay } from "./dayLookup.js";
import { InconsistentExecutionDateError, InconsistentExecutionLinkError } from "./errors.js";
import type { ExecutionSignal } from "./types.js";

export interface ResolveExecutionRelationshipInput {
  readonly timeline: AthleteTimeline;
  readonly decisionId: string;
}

export interface ExecutionRelationshipResolution {
  readonly signal: ExecutionSignal;
  /**
   * The raw same-day (decisionDate) CompletedSessionOnDay, if any —
   * regardless of link state. Deliberately the raw M5_002B shape, not an
   * M5_004-specific snapshot: each consumer formats it however it needs
   * (M5_004's SameDaySessionSnapshot builder for input_snapshot; M5_005
   * consumes only `signal`, never this field, at all).
   */
  readonly sameDaySession: CompletedSessionOnDay | null;
}

/**
 * Execution is anchored on decisionDate, never targetDate — the same
 * result is therefore reported identically across every horizon/detector
 * evaluation of a given decision, which is expected, not a redundancy to
 * fix.
 *
 * Two independent canonical views of the same underlying relationship are
 * cross-checked, never trusted alone:
 *   - `sameDay` — AthleteDay(decisionDate).completedSessions (date-driven).
 *   - `reverseLinked` — DecisionThread.linkedCompletedSessions (decision_id-driven).
 * Any disagreement between them is a structural inconsistency, never
 * repaired by picking one view over the other.
 *
 * Resolves its own canonical DecisionThread from `decisionId` via the
 * shared lookup primitive (resolveDecisionThreadById) — a caller that
 * already resolved the same thread for its own purposes (e.g. the M5_004
 * calculator, the M5_005 detector) will therefore trigger a second,
 * identical lookup here. This is a deliberate, small, harmless redundancy:
 * the alternative (accepting an externally-resolved DecisionThread as a
 * parameter) was explicitly rejected — this resolver's public API takes
 * only `decisionId`, never a pre-resolved thread.
 */
export function resolveExecutionRelationship(input: ResolveExecutionRelationshipInput): ExecutionRelationshipResolution {
  const { timeline, decisionId } = input;
  const thread: DecisionThread = resolveDecisionThreadById(timeline, decisionId);
  const decisionDate = thread.decisionDate;

  const decisionDay = resolveUniqueDay(timeline, decisionDate);
  if (decisionDay.completedSessions.length > 1) {
    throw new InconsistentExecutionLinkError(
      `AthleteDay(${decisionDate}) has ${decisionDay.completedSessions.length} completed sessions — violates the DB's UNIQUE(athlete_id, session_date) invariant`
    );
  }
  const sameDay: CompletedSessionOnDay | null = decisionDay.completedSessions[0] ?? null;

  const reverseLinked = thread.linkedCompletedSessions;
  if (reverseLinked.length > 1) {
    throw new InconsistentExecutionLinkError(
      `decision "${decisionId}" has ${reverseLinked.length} completed sessions explicitly linked via decision_id — expected at most one`
    );
  }
  if (reverseLinked.length === 1) {
    const linkedSession = reverseLinked[0]!;
    if (linkedSession.sessionDate !== decisionDate) {
      throw new InconsistentExecutionDateError(decisionId, decisionDate, linkedSession.id, linkedSession.sessionDate);
    }
  }

  // Bidirectional agreement — three exhaustive cases, matching the sameDay.decisionId classification below one-to-one.
  if (sameDay === null) {
    if (reverseLinked.length !== 0) {
      throw new InconsistentExecutionLinkError(
        `decision "${decisionId}" has a completed session explicitly linked via decision_id, but AthleteDay(${decisionDate}) has no completed session at all`
      );
    }
  } else if (sameDay.completedSession.decisionId === decisionId) {
    if (reverseLinked.length !== 1 || reverseLinked[0]!.id !== sameDay.completedSession.id) {
      throw new InconsistentExecutionLinkError(
        `AthleteDay(${decisionDate})'s completed session "${sameDay.completedSession.id}" claims decision_id "${decisionId}", but the reverse decision_id lookup does not agree`
      );
    }
  } else {
    // sameDay.decisionId is either null (unlinked) or a different decision's id (linked elsewhere).
    if (reverseLinked.length !== 0) {
      throw new InconsistentExecutionLinkError(
        `decision "${decisionId}" has a completed session explicitly linked via decision_id, but AthleteDay(${decisionDate})'s same-day session is not linked to this decision`
      );
    }
  }

  let signal: ExecutionSignal;
  if (sameDay === null) {
    signal = { state: "no_completed_session" };
  } else if (sameDay.completedSession.decisionId === null) {
    signal = { state: "same_day_session_unlinked" };
  } else if (sameDay.completedSession.decisionId === decisionId) {
    const s = sameDay.completedSession;
    signal = {
      state: "explicit",
      completedSessionId: s.id,
      sessionType: s.sessionType,
      completionStatus: s.completionStatus,
      actualDurationMin: s.actualDurationMin,
      rpe: s.rpe,
      sessionLoad: s.sessionLoad,
      postLegFatigue: s.postLegFatigue,
      postGripFatigue: s.postGripFatigue,
      newPain: s.newPain,
    };
  } else {
    signal = { state: "same_day_session_linked_elsewhere" };
  }

  return { signal, sameDaySession: sameDay };
}
