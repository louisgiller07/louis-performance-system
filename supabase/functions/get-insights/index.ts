// V0.3_001A — deterministic insight read path. See docs/06_ARCHITECTURE.md
// §V0.3_001 and docs/11_DECISION_LOG.md for the full locked architecture.
//
// GET /functions/v1/get-insights   (no query params, no body)
//
// Zero service_role anywhere in this file: pattern_evidence_current_effective
// and pattern_insight_review_current both retain `authenticated` SELECT +
// real RLS (verified against the actual migrations), so this endpoint reads
// exclusively via ctx.supabase, the RLS-scoped client — never
// ctx.supabaseAdmin. `candidateSnapshot` (server-only candidate authority)
// is always built server-side from the currently-effective evidence; the
// browser never supplies one.
//
// Imports the compiled longitudinal-engine/dist output, same convention as
// refresh-longitudinal/daily-run.
//
// CORS/OPTIONS: same Kong-gateway precedent as every other function in this
// project — no function-level CORS code here either.
import { withSupabase } from "@supabase/server";
import {
  aggregateEffectivePatternEvidence,
  buildPatternInsightCandidates,
  INSIGHT_AGGREGATION_RANGE,
  SupabasePatternEvidenceAggregationAdapter,
  SupabasePatternInsightReviewAdapter,
} from "../../../longitudinal-engine/dist/index.js";
import { mapGetInsightsError } from "./errorMapping.ts";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "GET") {
      return Response.json(
        { error: { code: "method_not_allowed", message: "Only GET is supported on this endpoint." } },
        { status: 405, headers: { Allow: "GET" } }
      );
    }

    // Strict no-input contract (locked): no query parameter may ever
    // influence athlete selection, range, or candidate calculation — the
    // athlete is always server-resolved from the JWT, and the range is
    // always the static INSIGHT_AGGREGATION_RANGE below. Any query
    // parameter at all (athleteId, range, fromDate, foo, ...) is rejected
    // outright rather than silently ignored.
    const url = new URL(req.url);
    if ([...url.searchParams.keys()].length > 0) {
      return errorResponse(400, "invalid_request", "This endpoint takes no query parameters.");
    }

    const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
    if (athleteError) {
      console.error(`get-insights: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }
    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }
    if (athletes.length > 1) {
      console.error("get-insights: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }
    const athleteId = athletes[0].id as string;

    try {
      const evidenceAdapter = new SupabasePatternEvidenceAggregationAdapter(ctx.supabase);
      const reviewAdapter = new SupabasePatternInsightReviewAdapter(ctx.supabase);

      const [evidence, currentReviews] = await Promise.all([
        evidenceAdapter.getCurrentEffectivePatternEvidence(athleteId, INSIGHT_AGGREGATION_RANGE),
        reviewAdapter.getCurrentPatternInsightReviews(athleteId),
      ]);

      const aggregates = aggregateEffectivePatternEvidence({ athleteId, range: INSIGHT_AGGREGATION_RANGE, evidence });
      const candidates = buildPatternInsightCandidates({ aggregates, currentReviews });

      return Response.json({ range: INSIGHT_AGGREGATION_RANGE, candidates }, { status: 200 });
    } catch (error) {
      const mapped = mapGetInsightsError(error);
      console.error(`get-insights: failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
      return errorResponse(mapped.status, mapped.code, mapped.message);
    }
  }),
};
