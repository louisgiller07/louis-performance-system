/**
 * Pure, deterministic validation for a TrainingPlanVersionLifecycleTransition
 * chain (M1 §7): valid state values, valid chain shape (transition_number
 * strictly increasing, supersedes_id links correctly, only allowed forward
 * moves per VALID_LIFECYCLE_TRANSITIONS), required-reason fields present
 * exactly when the type demands them.
 */
import { PlanningEngineValidationError } from "./errors.js";
import { VALID_LIFECYCLE_TRANSITIONS } from "../types/planLifecycle.js";
import type { TrainingPlanVersionLifecycleTransition } from "../types/planLifecycle.js";

function fail(reason: string, value: unknown): never {
  throw new PlanningEngineValidationError("TrainingPlanVersionLifecycleTransition chain", reason, value);
}

/**
 * Validates one ordered chain of transitions for a single plan version
 * (already sorted by transitionNumber ascending — this function does not
 * sort, it verifies ordering as an invariant).
 */
export function validateLifecycleChain(transitions: readonly TrainingPlanVersionLifecycleTransition[]): void {
  if (transitions.length === 0) fail("a plan version must have at least one transition", transitions);

  const first = transitions[0]!;
  if (first.transitionNumber !== 1) fail("the first transition must be transitionNumber 1", first);
  if (first.state !== "draft") fail("the first transition must be state \"draft\"", first);
  if (first.supersedesId !== undefined) fail("the first transition must not declare supersedesId", first);

  for (let i = 0; i < transitions.length; i++) {
    const current = transitions[i]!;

    if ((current.state === "superseded" || current.state === "abandoned") && current.reason.trim().length === 0) {
      fail(`transition ${current.transitionNumber} (${current.state}) requires a non-blank reason`, current);
    }

    if (i === 0) continue;

    const previous = transitions[i - 1]!;
    if (current.transitionNumber !== previous.transitionNumber + 1) {
      fail(`transitionNumber must increase by exactly 1 (got ${previous.transitionNumber} -> ${current.transitionNumber})`, current);
    }
    if (current.supersedesId !== previous.id) {
      fail(`transition ${current.transitionNumber}'s supersedesId must equal the previous transition's id`, current);
    }

    const allowedNext = VALID_LIFECYCLE_TRANSITIONS.get(previous.state);
    if (!allowedNext || !allowedNext.has(current.state)) {
      fail(`illegal transition from "${previous.state}" to "${current.state}"`, current);
    }
  }
}
