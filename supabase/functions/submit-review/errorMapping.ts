// V0.3_001C — maps submit-review's possible failures to a sanitized HTTP
// response. Same MANDATORY rule as get-insights/refresh-longitudinal: raw
// Postgres/RPC text never reaches the browser — logged server-side via
// console.error only, never echoed into the response body.
import {
  AggregationAthleteScopeMismatchError,
  DuplicateEffectiveEvidenceIdentityError,
  DuplicateEffectiveEvidenceKeyError,
  EvidenceOutsideAggregationRangeError,
  UnsupportedPatternInsightProjectorError,
} from "../../../longitudinal-engine/dist/index.js";

export interface MappedSubmitReviewError {
  status: number;
  code: string;
  message: string;
}

// Candidate-reconstruction failures — identical set/handling to get-insights,
// since submit-review reuses the exact same reconstruction path. Persistence
// (persist_pattern_insight_review) RPC failures propagate as plain Supabase
// PostgrestError-shaped objects (unwrapped, per persistPatternInsightReview's
// own documented contract) and fall through to the generic branch below —
// never parsed for message content, only ever logged with a stable prefix.
export function mapSubmitReviewError(error: unknown): MappedSubmitReviewError {
  if (error instanceof UnsupportedPatternInsightProjectorError) {
    return { status: 500, code: "unsupported_insight_projector", message: "An unexpected error occurred while resolving the current candidate." };
  }
  if (
    error instanceof AggregationAthleteScopeMismatchError ||
    error instanceof DuplicateEffectiveEvidenceIdentityError ||
    error instanceof DuplicateEffectiveEvidenceKeyError ||
    error instanceof EvidenceOutsideAggregationRangeError
  ) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while aggregating evidence." };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred while submitting the review." };
}
