/**
 * TrainingPlanVersionLifecycleTransition — append-only lifecycle chain for a
 * TrainingPlanVersion (M0 Issue 2). Mirrors
 * `pattern_evidence_lifecycle_transitions`'s already-proven shape exactly.
 * A version's current status is always its latest transition, never a
 * stored field on the version itself.
 *
 * `reason` is a discriminated requirement, not an optional field with a
 * runtime check bolted on: `superseded`/`abandoned` transitions cannot be
 * constructed without one at the type level; `draft`/`accepted` cannot
 * carry one. Illegal states are unrepresentable, not just invalid.
 */

interface TransitionBase {
  id: string;
  planVersionId: string;
  /** 1-based, strictly increasing per planVersionId — the first transition (always "draft") is transition_number 1, created atomically with the version. */
  transitionNumber: number;
  /** The transition this one supersedes — undefined only for transition_number 1. */
  supersedesId?: string;
  createdAt: string; // ISO datetime
}

export interface DraftTransition extends TransitionBase {
  state: "draft";
}

export interface AcceptedTransition extends TransitionBase {
  state: "accepted";
}

export interface SupersededTransition extends TransitionBase {
  state: "superseded";
  reason: string;
}

export interface AbandonedTransition extends TransitionBase {
  state: "abandoned";
  reason: string;
}

export type TrainingPlanVersionLifecycleTransition =
  | DraftTransition
  | AcceptedTransition
  | SupersededTransition
  | AbandonedTransition;

export type PlanLifecycleState = TrainingPlanVersionLifecycleTransition["state"];

/** Only these forward moves are valid; used by validation/validateLifecycle.ts. draft->superseded models "a newer version was accepted before this draft ever was". */
export const VALID_LIFECYCLE_TRANSITIONS: ReadonlyMap<PlanLifecycleState, ReadonlySet<PlanLifecycleState>> = new Map([
  ["draft", new Set<PlanLifecycleState>(["accepted", "abandoned", "superseded"])],
  ["accepted", new Set<PlanLifecycleState>(["superseded"])],
  ["superseded", new Set<PlanLifecycleState>([])],
  ["abandoned", new Set<PlanLifecycleState>([])],
]);
