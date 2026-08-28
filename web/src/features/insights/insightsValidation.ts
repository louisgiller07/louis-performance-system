import type {
  GetInsightsResponse,
  PatternEvidenceBalance,
  PatternEvidenceEventType,
  PatternEvidenceSourceRef,
  PatternInsightCandidate,
  PatternInsightCandidateReviewState,
  PatternInsightDirection,
  PatternInsightKind,
  PatternInsightReviewDecision,
  PatternInsightReviewRecord,
  PatternInsightSnapshot,
  SubmitReviewSuccess,
} from "./insightsTypes";

// supabase.functions.invoke<T>() only gives compile-time typing — the
// actual JSON on the wire is unchecked `unknown` until these guards run.
// Same "mirror only what's consumed" discipline as dailyPlanValidation.ts /
// completedSessionRepo.ts's own guards — no Zod/new dependency.
const ALLOWED_INSIGHT_KINDS: readonly PatternInsightKind[] = [
  "recommendation_execution_alignment",
  "sleep_energy_same_day_association",
  "pain_persistence_between_recent_checkins",
];
const ALLOWED_DIRECTIONS: readonly PatternInsightDirection[] = ["supporting", "contradicting", "mixed", "neutral"];
const ALLOWED_BALANCES: readonly PatternEvidenceBalance[] = [
  "neutral_only",
  "supporting_only",
  "contradicting_only",
  "supporting_majority",
  "contradicting_majority",
  "balanced",
];
const ALLOWED_EVENT_TYPES: readonly PatternEvidenceEventType[] = ["supporting", "contradicting", "neutral"];
const ALLOWED_REVIEW_STATES: readonly PatternInsightCandidateReviewState[] = ["unreviewed", "reviewed_current", "reviewed_stale"];
export const ALLOWED_REVIEW_DECISIONS: readonly PatternInsightReviewDecision[] = ["accepted_as_insight", "dismissed", "needs_more_evidence"];

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isSourceRef(value: unknown): value is PatternEvidenceSourceRef {
  return (
    isObject(value) &&
    typeof value.identityId === "string" &&
    typeof value.revisionId === "string" &&
    typeof value.revisionNumber === "number" &&
    typeof value.evaluationKey === "string" &&
    typeof value.evidenceKey === "string" &&
    isOneOf(value.eventType, ALLOWED_EVENT_TYPES) &&
    typeof value.eventDate === "string"
  );
}

function isSourceRefArray(value: unknown): value is PatternEvidenceSourceRef[] {
  return Array.isArray(value) && value.every(isSourceRef);
}

export function isSnapshot(value: unknown): value is PatternInsightSnapshot {
  if (!isObject(value)) return false;
  return (
    typeof value.insightProjectorVersion === "string" &&
    typeof value.athleteId === "string" &&
    isOneOf(value.insightKind, ALLOWED_INSIGHT_KINDS) &&
    typeof value.detectorRuleId === "string" &&
    typeof value.detectorRuleVersion === "string" &&
    typeof value.rangeFromDate === "string" &&
    typeof value.rangeToDate === "string" &&
    isOneOf(value.direction, ALLOWED_DIRECTIONS) &&
    typeof value.title === "string" &&
    typeof value.statement === "string" &&
    isStringArray(value.caveats) &&
    typeof value.evidenceCount === "number" &&
    typeof value.supportingCount === "number" &&
    typeof value.contradictingCount === "number" &&
    typeof value.neutralCount === "number" &&
    typeof value.directionalEvidenceCount === "number" &&
    isNumberOrNull(value.supportingRatio) &&
    isNumberOrNull(value.contradictingRatio) &&
    typeof value.neutralRatio === "number" &&
    isOneOf(value.evidenceBalance, ALLOWED_BALANCES) &&
    typeof value.firstEventDate === "string" &&
    typeof value.lastEventDate === "string" &&
    isSourceRefArray(value.sourceEvidenceRefs)
  );
}

function isReviewRecord(value: unknown): value is PatternInsightReviewRecord {
  return (
    isObject(value) &&
    typeof value.athleteId === "string" &&
    typeof value.detectorRuleId === "string" &&
    typeof value.detectorRuleVersion === "string" &&
    isOneOf(value.insightKind, ALLOWED_INSIGHT_KINDS) &&
    isOneOf(value.decision, ALLOWED_REVIEW_DECISIONS) &&
    typeof value.reviewNumber === "number" &&
    (value.reviewerNote === null || typeof value.reviewerNote === "string") &&
    isSnapshot(value.candidateSnapshot)
  );
}

export function isCandidate(value: unknown): value is PatternInsightCandidate {
  if (!isObject(value)) return false;
  if (!isSnapshot(value.snapshot)) return false;
  if (!isOneOf(value.reviewState, ALLOWED_REVIEW_STATES)) return false;
  if (value.currentReview !== null && !isReviewRecord(value.currentReview)) return false;
  return true;
}

export function isGetInsightsResponse(value: unknown): value is GetInsightsResponse {
  if (!isObject(value)) return false;
  if (!isObject(value.range) || typeof value.range.fromDate !== "string" || typeof value.range.toDate !== "string") return false;
  return Array.isArray(value.candidates) && value.candidates.every(isCandidate);
}

export function isSubmitReviewSuccess(value: unknown): value is SubmitReviewSuccess {
  return isObject(value) && isOneOf(value.action, ["inserted", "superseded", "unchanged"]) && typeof value.reviewNumber === "number";
}
