// V0.3_001A — maps get-insights' possible failures to a sanitized HTTP
// response. Same MANDATORY rule as refresh-longitudinal: raw Postgres/RPC
// text never reaches the browser — logged server-side via console.error
// only, never echoed into the response body.
import {
  AggregationAthleteScopeMismatchError,
  DuplicateEffectiveEvidenceIdentityError,
  DuplicateEffectiveEvidenceKeyError,
  EvidenceOutsideAggregationRangeError,
  UnsupportedPatternInsightProjectorError,
} from "../../../longitudinal-engine/dist/index.js";

export interface MappedGetInsightsError {
  status: number;
  code: string;
  message: string;
}

// Every branch here represents a server-side data/registry integrity
// violation, never a client-correctable request (this endpoint takes no
// input at all) — all map to 500, distinguished only for observability.
export function mapGetInsightsError(error: unknown): MappedGetInsightsError {
  if (error instanceof UnsupportedPatternInsightProjectorError) {
    return { status: 500, code: "unsupported_insight_projector", message: "An unexpected error occurred while projecting insights." };
  }
  if (
    error instanceof AggregationAthleteScopeMismatchError ||
    error instanceof DuplicateEffectiveEvidenceIdentityError ||
    error instanceof DuplicateEffectiveEvidenceKeyError ||
    error instanceof EvidenceOutsideAggregationRangeError
  ) {
    return { status: 500, code: "internal_error", message: "An unexpected error occurred while aggregating evidence." };
  }
  return { status: 500, code: "internal_error", message: "An unexpected error occurred while loading insights." };
}
