// V0.3_001C — submit-review: explicit human review persistence for M5_007
// insight candidates. See docs/06_ARCHITECTURE.md §V0.3_001 and
// docs/11_DECISION_LOG.md (V0.3_001C freshness-linearization and
// candidate-resolution lock entries, both 2026-08-28) for the full locked
// architecture this endpoint implements.
//
// POST /functions/v1/submit-review   body: exactly the 7 locked freshness
//   dimensions (detectorRuleId/detectorRuleVersion/insightKind/
//   insightProjectorVersion/rangeFromDate/rangeToDate/sourceEvidenceRefs)
//   plus decision, plus optional reviewerNote — never athleteId, never
//   candidateSnapshot, never any server-owned field. The athlete is always
//   resolved server-side from the JWT, never accepted from the client.
//
// Candidate authority: browser = NONE, server = COMPLETE. The candidate
// persisted is always the one the server independently reconstructs via
// the EXACT same path get-insights uses (aggregateEffectivePatternEvidence
// -> buildPatternInsightCandidates) — never anything derived from the
// request body's own field values beyond the 7-dimension comparison itself.
//
// Candidate selector = (server-resolved athleteId, detectorRuleId) only —
// never detectorRuleVersion/insightKind, whose divergence must resolve to
// stale_candidate rather than candidate_not_found (locked 2026-08-28).
// Cardinality: 0 matches -> candidate_not_found; 1 -> compare the 7
// dimensions; >1 -> invariant violation, sanitized internal_error, no
// arbitrary first/array[0]/sort-order selection, no write.
//
// Freshness linearization = the successful server comparison, not
// persistence commit (semantics A, locked 2026-08-28): a candidate fresh
// at comparison time remains valid to persist even if effective evidence
// changes immediately afterward; the resulting review may legitimately
// project reviewed_stale on a later get-insights read — that is expected,
// never a retroactive error.
//
// Imports the compiled longitudinal-engine/dist output, same convention as
// every other Edge Function in this project.
//
// CORS/OPTIONS: same Kong-gateway precedent as every other function here —
// no function-level CORS code.
import { withSupabase } from "@supabase/server";
import {
  aggregateEffectivePatternEvidence,
  buildPatternInsightCandidates,
  INSIGHT_AGGREGATION_RANGE,
  persistPatternInsightReview,
  resolveCandidateForReview,
  SupabasePatternEvidenceAggregationAdapter,
  SupabasePatternInsightReviewAdapter,
} from "../../../longitudinal-engine/dist/index.js";
import { mapSubmitReviewError } from "./errorMapping.ts";
import { validateSubmitReviewRequest } from "./requestValidation.ts";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json(
        { error: { code: "method_not_allowed", message: "Only POST is supported on this endpoint." } },
        { status: 405, headers: { Allow: "POST" } }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "invalid_request", "Request body must be valid JSON.");
    }

    const validation = validateSubmitReviewRequest(body);
    if (!validation.ok) {
      return errorResponse(400, "invalid_request", validation.message);
    }
    const request = validation.value;

    // Athlete resolution via the RLS-scoped ctx.supabase client only —
    // identical pattern to get-insights/refresh-longitudinal/daily-run.
    // Never accepted from the request body (rejected outright above as an
    // unknown field if present).
    const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
    if (athleteError) {
      console.error(`submit-review: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }
    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }
    if (athletes.length > 1) {
      console.error("submit-review: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }
    const athleteId = athletes[0].id as string;

    try {
      // Canonical current-candidate reconstruction — the EXACT same
      // read-only path get-insights uses. ctx.supabase only (RLS-scoped):
      // never ctx.supabaseAdmin for reconstruction, only for the
      // persistence RPC call below.
      const evidenceAdapter = new SupabasePatternEvidenceAggregationAdapter(ctx.supabase);
      const reviewAdapter = new SupabasePatternInsightReviewAdapter(ctx.supabase);

      const [evidence, currentReviews] = await Promise.all([
        evidenceAdapter.getCurrentEffectivePatternEvidence(athleteId, INSIGHT_AGGREGATION_RANGE),
        reviewAdapter.getCurrentPatternInsightReviews(athleteId),
      ]);

      const aggregates = aggregateEffectivePatternEvidence({ athleteId, range: INSIGHT_AGGREGATION_RANGE, evidence });
      const candidates = buildPatternInsightCandidates({ aggregates, currentReviews });

      const resolution = resolveCandidateForReview(candidates, athleteId, {
        detectorRuleId: request.detectorRuleId,
        detectorRuleVersion: request.detectorRuleVersion,
        insightKind: request.insightKind,
        insightProjectorVersion: request.insightProjectorVersion,
        rangeFromDate: request.rangeFromDate,
        rangeToDate: request.rangeToDate,
        sourceEvidenceRefs: request.sourceEvidenceRefs,
      });

      if (resolution.status === "not_found") {
        return errorResponse(404, "candidate_not_found", "No current candidate exists for this detector.");
      }

      if (resolution.status === "invariant_violation") {
        console.error(`submit-review: candidate selector invariant violation — detectorRuleId=${request.detectorRuleId} matchCount=${resolution.matchCount}`);
        return errorResponse(500, "internal_error", "An unexpected error occurred while resolving the current candidate.");
      }

      if (resolution.status === "stale") {
        return Response.json(
          {
            error: { code: "stale_candidate", message: "The candidate you reviewed has changed since it was loaded. A fresh version is included below." },
            candidate: resolution.candidate,
          },
          { status: 409 }
        );
      }

      // resolution.status === "matched" — freshness linearizes HERE. Persist
      // the SERVER-rebuilt candidate exactly as selected at this comparison;
      // never re-validated against any later evidence state (locked
      // semantics A, 2026-08-28). ctx.supabaseAdmin used ONLY for this
      // service_role-gated RPC call, never for reconstruction/reads above.
      const persistResult = await persistPatternInsightReview(ctx.supabaseAdmin, {
        athleteId,
        candidate: resolution.candidate,
        decision: request.decision,
        reviewerNote: request.reviewerNote,
      });

      return Response.json({ review: { action: persistResult.action, reviewNumber: persistResult.reviewNumber } }, { status: 200 });
    } catch (error) {
      const mapped = mapSubmitReviewError(error);
      console.error(`submit-review: failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
      return errorResponse(mapped.status, mapped.code, mapped.message);
    }
  }),
};
