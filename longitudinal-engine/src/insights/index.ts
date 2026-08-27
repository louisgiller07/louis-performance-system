/**
 * M5_007 public surface: deterministic insight projection over M5_006D
 * aggregates + human-review-state derivation. Pure — no I/O, no clock, no
 * randomness. See buildPatternInsightCandidates.ts's own doc for the full
 * architectural boundary this package enforces.
 */
export { buildPatternInsightCandidates } from "./buildPatternInsightCandidates.js";
export type { BuildPatternInsightCandidatesInput } from "./buildPatternInsightCandidates.js";
export { UnsupportedPatternInsightProjectorError } from "./errors.js";
export { PATTERN_INSIGHT_PROJECTOR_VERSION, SUPPORTED_INSIGHT_PROJECTORS, INSIGHT_COPY, resolveInsightKind } from "./registry.js";
export type {
  PatternInsightKind,
  PatternInsightDirection,
  PatternInsightSnapshot,
  PatternInsightReviewDecision,
  PatternInsightCandidateReviewState,
  PatternInsightReviewRecord,
  PatternInsightCandidate,
} from "./types.js";
