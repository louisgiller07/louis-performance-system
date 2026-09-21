/**
 * Pure, deterministic precondition check for PlanInputSnapshot (M0 Issue 4 /
 * M1 §7/§8). Recurring availability is REQUIRED before first generation —
 * never a permissive "assume fully available" default. This is a distinct
 * failure mode from PlanningEngineValidationError's "malformed data" —
 * GenerationBlockedError represents "the data is validly absent (or
 * unconfirmable), and that absence is itself the reason generation cannot
 * proceed," matching the M0 decision's own "positive-confirmation-only"
 * rule: any failure to positively confirm availability blocks generation
 * identically, whether the cause is "never configured" or "could not be
 * read" — this package has no I/O of its own, so callers are expected to
 * translate a read failure into simply not calling this function with a
 * confirmed snapshot, or to catch their own read error and raise this same
 * error type for consistency.
 */

export type GenerationBlockedReason = "missing_availability";

export class GenerationBlockedError extends Error {
  constructor(public readonly blockedReason: GenerationBlockedReason) {
    super(`Plan generation blocked: ${blockedReason}`);
    this.name = "GenerationBlockedError";
  }
}

/**
 * Throws {@link GenerationBlockedError} if `availability.windows` is empty —
 * "explicitly declared full availability" produces real window entries
 * (even a single "all day, every day" entry counts); zero entries always
 * means "never configured," never "unlimited."
 */
export function assertAvailabilityDeclared(availability: { windows: readonly unknown[] }): void {
  if (availability.windows.length === 0) {
    throw new GenerationBlockedError("missing_availability");
  }
}
