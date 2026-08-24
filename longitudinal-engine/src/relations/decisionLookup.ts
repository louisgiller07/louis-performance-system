/**
 * Shared canonical decision-thread resolution — one implementation reused
 * by calculators/decisionOutcomeSnapshot.ts, executionRelationship.ts (this
 * same directory), and detectors/recommendationVsActualExecution.ts, so the
 * lookup semantics/errors can never diverge between consumers (M5_004/
 * M5_005 lock: "do not create two divergent lookup implementations").
 */
import type { AthleteTimeline, DecisionThread } from "../timeline/types.js";
import { DecisionNotFoundInTimelineError, DuplicateDecisionThreadError } from "./errors.js";

/**
 * Resolves the canonical DecisionThread for `decisionId` by value equality
 * (`thread.decision.id === decisionId`) only — never `.includes()` or any
 * JavaScript reference-identity check (M5_002B explicitly forbids
 * reference-identity invariants).
 */
export function resolveDecisionThreadById(timeline: AthleteTimeline, decisionId: string): DecisionThread {
  const matches = timeline.decisionThreads.filter((t) => t.decision.id === decisionId);
  if (matches.length === 0) throw new DecisionNotFoundInTimelineError(decisionId);
  if (matches.length > 1) throw new DuplicateDecisionThreadError(decisionId, matches.length);
  return matches[0]!;
}
