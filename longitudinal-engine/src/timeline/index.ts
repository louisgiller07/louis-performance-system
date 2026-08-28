/**
 * Public surface: buildTimeline, its types, package-owned expected errors,
 * and the two constants a consumer can legitimately want (the version tag
 * echoed in provenance, and the canonical horizon list for iterating
 * DecisionThread.outcomesByHorizon). Internal assembly helpers
 * (assertAthleteScoped, materializeDateRange, and everything in linking.ts/
 * ordering.ts/partitioning.ts/healthContext.ts/assembleDay.ts/
 * decisionThread.ts/healthFlagThread.ts/provenance.ts beyond the error
 * classes) are deliberately not re-exported here — tests reach them via
 * direct relative imports instead, which is fine for code inside this
 * same package.
 */
export type {
  AthleteDay,
  AthleteTimeline,
  BuildTimelineInput,
  CompletedSessionOnDay,
  DecisionOutcomesByHorizon,
  DecisionThread,
  HealthFlagThread,
  Link,
  TimelineProvenance,
  TimelineSources,
} from "./types.js";
export { TIMELINE_BUILDER_VERSION, DECISION_OUTCOME_HORIZONS } from "./constants.js";
export { InvalidDateRangeError } from "./range.js";
export { TimelineAthleteMismatchError } from "./athleteScoping.js";
export { OrphanedDecisionOutcomeError } from "./decisionThread.js";
export { buildTimeline } from "./buildTimeline.js";
export { currentLongitudinalProcessingDate, LONGITUDINAL_PROCESSING_TIMEZONE } from "./processingDate.js";
