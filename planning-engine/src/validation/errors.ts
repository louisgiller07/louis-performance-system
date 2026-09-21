/**
 * Shared error shape for this package's validators — same discipline as
 * head-coach-engine's InvalidTrainingInterventionJsonError: throw a typed
 * error carrying `reason` + the offending `value`, never silently coerce or
 * return a best-guess. Validators in this package throw, they do not
 * return a Result<T, E> — matching the one existing runtime-validation
 * precedent in this codebase exactly.
 */
export class PlanningEngineValidationError extends Error {
  constructor(
    context: string,
    public readonly reason: string,
    public readonly value: unknown
  ) {
    super(`Invalid ${context}: ${reason}`);
    this.name = "PlanningEngineValidationError";
  }
}
