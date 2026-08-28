// V0.3_001A — longitudinal intelligence runtime orchestration. See
// docs/06_ARCHITECTURE.md §V0.3_001 and docs/11_DECISION_LOG.md for the
// full locked architecture this endpoint implements.
//
// POST /functions/v1/refresh-longitudinal   body: {} (no fields at all —
//   never athleteId/date/range; the caller's own athlete and the current
//   Europe/Zurich processing date are both resolved server-side, never
//   accepted from the client).
//
// Imports the compiled longitudinal-engine/dist output (never the M5
// TypeScript source directly), the same NodeNext/dist-import convention
// already proven by daily-run's own import of head-coach-engine/dist.
//
// Execution order (locked): authenticate -> resolve athlete (ctx.supabase,
// RLS-scoped, never client-supplied) -> compute longitudinalProcessingDate
// -> assembleAthleteTimeline (ctx.supabase for the 5 source reads — all
// five tables retain `authenticated` SELECT + real RLS, verified against
// the actual migrations) -> calculateAndPersistOutcomes (ctx.supabaseAdmin,
// the ONLY write path for decision_outcomes) -> runDetectors (SAME
// timeline, ctx.supabaseAdmin, no reload) -> sanitized summary response.
//
// CORS/OPTIONS: same Kong-gateway precedent as daily-run/completed-session
// — no function-level CORS code here either.
import { withSupabase } from "@supabase/server";
import {
  assembleAthleteTimeline,
  calculateAndPersistOutcomes,
  currentLongitudinalProcessingDate,
  runDetectors,
} from "../../../longitudinal-engine/dist/index.js";
import { mapRefreshLongitudinalError } from "./errorMapping.ts";
import { buildRefreshLongitudinalResponse } from "./responseShaping.ts";

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

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "invalid_request", "Request body must be a JSON object.");
    }

    const bodyKeys = Object.keys(body as Record<string, unknown>);
    if (bodyKeys.length > 0) {
      return errorResponse(400, "invalid_request", `This endpoint takes no request fields. Unknown propert${bodyKeys.length === 1 ? "y" : "ies"}: ${bodyKeys.join(", ")}.`);
    }

    // Athlete resolution via the RLS-scoped ctx.supabase client only —
    // identical pattern to daily-run/completed-session.
    const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
    if (athleteError) {
      console.error(`refresh-longitudinal: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }
    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }
    if (athletes.length > 1) {
      console.error("refresh-longitudinal: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }
    const athleteId = athletes[0].id as string;

    try {
      const longitudinalProcessingDate = currentLongitudinalProcessingDate();

      // Timeline-source reads use ctx.supabase (authenticated, RLS-scoped) —
      // least privilege: this is a read path only, and RLS already confines
      // it to the caller's own rows.
      const timeline = await assembleAthleteTimeline({ client: ctx.supabase, athleteId, longitudinalProcessingDate });

      // Writes use ctx.supabaseAdmin exclusively, via the existing frozen
      // RPCs (persist_decision_outcome / persist_active_pattern_evidence /
      // transition_pattern_evidence_lifecycle) — never a second write path.
      const outcomes = await calculateAndPersistOutcomes({ supabaseAdmin: ctx.supabaseAdmin, timeline, observedThroughDate: longitudinalProcessingDate });
      const detectors = await runDetectors({ supabaseAdmin: ctx.supabaseAdmin, timeline });

      // Sanitized summary only — per-item error STRINGS (which may embed a
      // raw Postgres/RPC message) stay server-side in the orchestrators'
      // own return values for logs; buildRefreshLongitudinalResponse is the
      // SOLE production transport-builder and never reads `.error` beyond
      // deciding an error occurred (see responseShaping.ts's own doc).
      // status flags whether every item succeeded, without ever using an
      // HTTP 207 — both "complete" and "partial_failure" are HTTP 200.
      if (outcomes.errors.length > 0 || detectors.errors.length > 0) {
        console.error(
          `refresh-longitudinal: partial failure — outcomes.errors=${outcomes.errors.length} detectors.errors=${detectors.errors.length}`
        );
      }

      const responseBody = buildRefreshLongitudinalResponse(longitudinalProcessingDate, outcomes, detectors);
      return Response.json(responseBody, { status: 200 });
    } catch (error) {
      const mapped = mapRefreshLongitudinalError(error);
      console.error(`refresh-longitudinal: failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
      return errorResponse(mapped.status, mapped.code, mapped.message);
    }
  }),
};
