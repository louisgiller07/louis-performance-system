// Calls the real remote Edge Functions get-insights (GET, no params) and
// submit-review (POST). Both go through supabase.functions.invoke, which
// already attaches the signed-in user's JWT — nothing manual is added
// here. No direct reads/writes against pattern_evidence_*/pattern_insight_*/
// athletes; no service_role anywhere in this file.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { INVALID_RESPONSE_ERROR, mapInsightsError, mapParsedInsightsError, parseFunctionsHttpError, type InsightsError } from "./insightsErrors";
import { isCandidate, isGetInsightsResponse, isSubmitReviewSuccess } from "./insightsValidation";
import type { GetInsightsResponse, PatternInsightCandidate, PatternInsightReviewDecision, SubmitReviewRequestBody, SubmitReviewSuccess } from "./insightsTypes";

export type GetInsightsResult = { ok: true; data: GetInsightsResponse } | { ok: false; error: InsightsError };

export async function getInsights(): Promise<GetInsightsResult> {
  const { data, error } = await supabase.functions.invoke<unknown>("get-insights", { method: "GET" });
  if (error) return { ok: false, error: await mapInsightsError(error) };
  if (!isGetInsightsResponse(data)) return { ok: false, error: INVALID_RESPONSE_ERROR };
  return { ok: true, data };
}

/**
 * Builds the EXACT allowed submit-review request body from the currently-
 * rendered candidate's own server snapshot — the 7 locked freshness
 * dimensions (see supabase/functions/submit-review/requestValidation.ts's
 * own allow-list), plus decision and reviewerNote. Never athleteId, never
 * candidateSnapshot/candidate, never title/statement/counts/ratios/any
 * other snapshot field — a caller cannot accidentally widen this by passing
 * more than `snapshot` in.
 */
export function buildSubmitReviewBody(
  snapshot: PatternInsightCandidate["snapshot"],
  decision: PatternInsightReviewDecision,
  reviewerNote: string | null
): SubmitReviewRequestBody {
  return {
    detectorRuleId: snapshot.detectorRuleId,
    detectorRuleVersion: snapshot.detectorRuleVersion,
    insightKind: snapshot.insightKind,
    insightProjectorVersion: snapshot.insightProjectorVersion,
    rangeFromDate: snapshot.rangeFromDate,
    rangeToDate: snapshot.rangeToDate,
    sourceEvidenceRefs: snapshot.sourceEvidenceRefs,
    decision,
    reviewerNote,
  };
}

export type SubmitReviewResult =
  | { ok: true; data: SubmitReviewSuccess }
  | { ok: false; kind: "stale_candidate"; candidate: PatternInsightCandidate; error: InsightsError }
  | { ok: false; kind: "candidate_not_found"; error: InsightsError }
  | { ok: false; kind: "other"; error: InsightsError };

/**
 * The success response ({action, reviewNumber}) is NOT authoritative
 * review state on its own — callers MUST re-fetch getInsights() after any
 * outcome (success, stale_candidate, candidate_not_found) and render
 * whatever the server then returns, never derive reviewState locally. See
 * InsightsPage's own submit handler.
 */
export async function submitReview(body: SubmitReviewRequestBody): Promise<SubmitReviewResult> {
  const { data, error } = await supabase.functions.invoke<unknown>("submit-review", { body });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      // Body read EXACTLY ONCE here — never pass this same error into
      // mapInsightsError afterward (it would try to read the body again).
      const parsed = await parseFunctionsHttpError(error);

      if (parsed.code === "candidate_not_found") {
        return { ok: false, kind: "candidate_not_found", error: mapParsedInsightsError(parsed) };
      }

      if (parsed.code === "stale_candidate") {
        const rawCandidate = parsed.rawBody && typeof parsed.rawBody === "object" ? (parsed.rawBody as { candidate?: unknown }).candidate : undefined;
        if (isCandidate(rawCandidate)) {
          return { ok: false, kind: "stale_candidate", candidate: rawCandidate, error: mapParsedInsightsError(parsed) };
        }
        // A malformed stale_candidate body is never trusted as a real
        // candidate — falls through to a generic invalid-response failure.
        return { ok: false, kind: "other", error: INVALID_RESPONSE_ERROR };
      }

      return { ok: false, kind: "other", error: mapParsedInsightsError(parsed) };
    }

    return { ok: false, kind: "other", error: await mapInsightsError(error) };
  }

  // Production success shape is { review: { action, reviewNumber } } — see
  // supabase/functions/submit-review/index.ts's own Response.json call.
  const review = data && typeof data === "object" ? (data as { review?: unknown }).review : undefined;
  if (!isSubmitReviewSuccess(review)) return { ok: false, kind: "other", error: INVALID_RESPONSE_ERROR };
  return { ok: true, data: review };
}
