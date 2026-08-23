/**
 * M5_004 public surface: the pure calculator, its horizon-date helpers
 * (also reused by supabase/outcomeOrchestrator.ts for its own maturity
 * pre-filter), its frozen calculator identity, its error taxonomy, and its
 * data shapes. No I/O, no clock, no randomness anywhere under this
 * directory — see decisionOutcomeSnapshot.ts's own module doc.
 */
export { calculateDecisionOutcomeSnapshot } from "./decisionOutcomeSnapshot.js";
export type { CalculateDecisionOutcomeSnapshotInput } from "./decisionOutcomeSnapshot.js";
export { targetDateForHorizon, isHorizonMature, validateObservedThroughDate } from "./horizonDates.js";
export { CALCULATOR_ID, CALCULATOR_VERSION, OUTCOME_SCHEMA_VERSION } from "./constants.js";
export {
  DecisionNotFoundInTimelineError,
  DuplicateDecisionThreadError,
  InvalidObservedThroughDateError,
  InvalidHorizonError,
  HorizonNotMatureError,
  OutcomeTimelineCoverageError,
  InconsistentTimelineDayError,
  InconsistentTargetCheckinError,
  InconsistentBaselineCheckinError,
  InconsistentExecutionLinkError,
  InconsistentExecutionDateError,
} from "./errors.js";
export type {
  DecisionOutcomeCalculation,
  InputSnapshot,
  OutcomeSignals,
  SignalValue,
  DeltaValue,
  DeltaUnavailableReason,
  ExecutionSignal,
  ResponseSignals,
  DeltaSignals,
  HealthContextSignals,
  HealthFlagRef,
  CheckinSnapshot,
  SameDaySessionSnapshot,
} from "./types.js";
