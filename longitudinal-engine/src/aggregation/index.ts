/**
 * M5_006D public surface: deterministic aggregation over currently-effective
 * pattern evidence (`pattern_evidence_current_effective` rows only). No
 * I/O, no clock, no randomness — see aggregateEffectivePatternEvidence.ts's
 * own doc for the full architectural boundary this package enforces.
 */
export { aggregateEffectivePatternEvidence } from "./aggregateEffectivePatternEvidence.js";
export {
  AggregationAthleteScopeMismatchError,
  EvidenceOutsideAggregationRangeError,
  DuplicateEffectiveEvidenceIdentityError,
  DuplicateEffectiveEvidenceKeyError,
} from "./errors.js";
export type {
  PatternEvidenceEventType,
  PatternEvidenceCurrentEffectiveRow,
  PatternEvidenceAggregateSourceRef,
  PatternEvidenceBalance,
  PatternEvidenceAggregate,
  AggregateEffectivePatternEvidenceInput,
} from "./types.js";
