export { SupabaseLongitudinalSourceAdapter } from "./adapter.js";
export { SupabasePatternEvidenceAggregationAdapter } from "./patternEvidenceAggregationAdapter.js";
export { SupabasePatternInsightReviewAdapter } from "./patternInsightReviewAdapter.js";
export { InvalidSourceRowError } from "./rowMapping.js";
export { calculateAndPersistOutcomes, DuplicatePersistedOutcomeError } from "./outcomeOrchestrator.js";
export type {
  CalculateAndPersistOutcomesParams,
  OutcomeOrchestrationResult,
  OutcomeOrchestrationItemError,
} from "./outcomeOrchestrator.js";

// V0.3_001A — longitudinal intelligence runtime (architecture locked, see docs/06_ARCHITECTURE.md §V0.3_001).
export { runDetectors } from "./detectorOrchestrator.js";
export type {
  RunDetectorsParams,
  DetectorOrchestrationResult,
  DetectorOrchestrationItemResult,
  DetectorOrchestrationItemError,
  DetectorOrchestrationAction,
} from "./detectorOrchestrator.js";
export { assembleAthleteTimeline } from "./assembleAthleteTimeline.js";
export type { AssembleAthleteTimelineParams } from "./assembleAthleteTimeline.js";
export { INSIGHT_AGGREGATION_RANGE, DOMAIN_HISTORY_FLOOR_DATE } from "./runtimeRanges.js";
