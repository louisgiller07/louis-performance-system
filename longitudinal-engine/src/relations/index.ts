/**
 * Public surface of the shared decision/execution-relationship domain —
 * consumed by both `calculators/**` (M5_004) and `detectors/**` (M5_005).
 * No I/O, no clock, no randomness anywhere under this directory.
 */
export { resolveExecutionRelationship } from "./executionRelationship.js";
export type { ResolveExecutionRelationshipInput, ExecutionRelationshipResolution } from "./executionRelationship.js";
export { resolveDecisionThreadById } from "./decisionLookup.js";
export { resolveUniqueDay } from "./dayLookup.js";
export type { ExecutionSignal } from "./types.js";
export {
  DecisionNotFoundInTimelineError,
  DuplicateDecisionThreadError,
  InconsistentTimelineDayError,
  InconsistentExecutionLinkError,
  InconsistentExecutionDateError,
} from "./errors.js";
