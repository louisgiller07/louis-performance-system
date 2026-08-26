/**
 * M5_005 public surface: the recommendation-vs-actual-execution detector,
 * its frozen identity, its own error taxonomy, and its result shapes. No
 * I/O, no clock, no randomness anywhere under this directory. Shared
 * decision/execution errors (DecisionNotFoundInTimelineError,
 * DuplicateDecisionThreadError, InconsistentExecutionLinkError,
 * InconsistentExecutionDateError, InconsistentTimelineDayError) are NOT
 * re-exported here — consumers reuse the single canonical identity from
 * `relations/index.js` (or `calculators/index.js`, which re-exports the
 * same classes) instead of a duplicate here.
 *
 * Identity constants are deliberately detector-specific
 * (`RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID`/`_VERSION`), never a
 * generic `DETECTOR_RULE_ID`/`DETECTOR_RULE_VERSION` — `detectors/**` is
 * expected to host more than one detector over time, each needing its own
 * unambiguous package-root name.
 */
export { detectRecommendationVsActualExecution } from "./recommendationVsActualExecution.js";
export type { DetectRecommendationVsActualExecutionInput } from "./recommendationVsActualExecution.js";
export { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION } from "./constants.js";
export { AthleteScopeMismatchError, CompletionStatusTypeMismatchError } from "./errors.js";
export type {
  DetectorEventType,
  RecommendationVsActualDetection,
  RecommendationVsActualEvidence,
  RecommendationVsActualNoEvidence,
  RecommendationVsActualObservedValue,
  RecommendationVsActualRuleId,
  RecommendationVsActualSourceRefs,
  NoEvidenceReason,
} from "./types.js";

// M5_006B — sleep_quality_to_same_day_energy_correlation detector.
export { detectSleepQualityToSameDayEnergyCorrelation } from "./sleepQualityToSameDayEnergyCorrelation.js";
export type { DetectSleepQualityToSameDayEnergyCorrelationInput } from "./sleepQualityToSameDayEnergyCorrelation.js";
export { SLEEP_ENERGY_RULE_ID, SLEEP_ENERGY_RULE_VERSION, SLEEP_ENERGY_RANKING_METHOD } from "./sleepEnergyConstants.js";
export { CheckinNotFoundInTimelineError, InsufficientTimelineCoverageError, DuplicateCheckinDateError } from "./sleepEnergyErrors.js";
export type {
  SleepEnergyRuleId,
  SleepEnergyBucket,
  RatingHistogram,
  SleepEnergyConfounderReason,
  SleepEnergySourceRefs,
  SleepEnergyObservedValue,
  SleepEnergyEvidence,
  SleepEnergyNoEvidenceReason,
  SleepEnergyNoEvidence,
  SleepEnergyDetection,
} from "./sleepEnergyTypes.js";

// M5_006C — pain_persistence_across_recent_checkins detector.
export { detectPainPersistenceAcrossRecentCheckins } from "./painPersistenceAcrossRecentCheckins.js";
export type { DetectPainPersistenceAcrossRecentCheckinsInput } from "./painPersistenceAcrossRecentCheckins.js";
export { PAIN_PERSISTENCE_RULE_ID, PAIN_PERSISTENCE_RULE_VERSION, PAIN_PERSISTENCE_LOOKBACK_DAYS } from "./painPersistenceConstants.js";
export { InconsistentPainStateError } from "./painPersistenceErrors.js";
export type {
  PainPersistenceRuleId,
  PainPersistenceTransitionKind,
  PainPersistenceAmbiguityReason,
  PainPersistenceSourceRefs,
  PainPersistenceObservedValue,
  PainPersistenceEvidence,
  PainPersistenceNoEvidenceReason,
  PainPersistenceNoEvidence,
  PainPersistenceDetection,
} from "./painPersistenceTypes.js";
