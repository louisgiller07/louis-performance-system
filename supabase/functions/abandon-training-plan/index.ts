// V0.4_102 — abandon-training-plan Edge Function. Exact same architecture as
// daily-run/index.ts (M3_003): withSupabase auth boundary, athleteId
// resolved via the RLS-scoped client, the actual RPC call made through the
// admin client, errors mapped via a sibling errorMapping.ts. No new Edge
// Function architecture, no new authentication mechanism.
import { withSupabase } from "@supabase/server";
import { abandonTrainingPlanVersionRpc } from "../../../head-coach-engine/dist/supabase/abandonTrainingPlanVersionRpc.js";
import { mapAbandonError } from "./errorMapping.ts";

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BODY_KEYS = ["planVersionId", "reason"];

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
    const unknownKeys = bodyKeys.filter((key) => !ALLOWED_BODY_KEYS.includes(key));
    if (unknownKeys.length > 0) {
      return errorResponse(
        400,
        "invalid_request",
        `Unknown propert${unknownKeys.length === 1 ? "y" : "ies"}: ${unknownKeys.join(", ")}.`
      );
    }

    const planVersionIdValue = (body as Record<string, unknown>).planVersionId;
    if (typeof planVersionIdValue !== "string" || !UUID_FORMAT.test(planVersionIdValue)) {
      return errorResponse(400, "invalid_request", "planVersionId is required and must be a valid UUID.");
    }

    const reasonValue = (body as Record<string, unknown>).reason;
    if (typeof reasonValue !== "string" || reasonValue.trim().length === 0) {
      return errorResponse(400, "invalid_request", "reason is required and must not be blank.");
    }

    // Athlete resolution goes through the RLS-scoped `ctx.supabase` client,
    // never `ctx.supabaseAdmin` — same reasoning as daily-run: prove the
    // caller's athlete is resolved via RLS, not a client-supplied id.
    const { data: athletes, error: athleteError } = await ctx.supabase
      .from("athletes")
      .select("id");

    if (athleteError) {
      console.error(`abandon-training-plan: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }

    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }

    if (athletes.length > 1) {
      // Defensive: athletes.user_id is UNIQUE, so this should be
      // unreachable. Refuse to arbitrarily pick a row rather than silently
      // proceeding with the wrong athlete.
      console.error("abandon-training-plan: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }

    const athleteId = athletes[0].id as string;

    try {
      // ctx.supabaseAdmin only — athleteId came exclusively from the
      // RLS-scoped ctx.supabase query above, never from client input.
      const result = await abandonTrainingPlanVersionRpc(ctx.supabaseAdmin, athleteId, planVersionIdValue, reasonValue);
      return Response.json(
        {
          planVersionId: result.planVersionId,
          idempotentReplay: result.idempotentReplay,
          abandonedTransitionId: result.abandonedTransitionId,
        },
        { status: 200 }
      );
    } catch (error) {
      const mapped = mapAbandonError(error);
      console.error(`abandon-training-plan: abandonTrainingPlanVersionRpc failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
      return errorResponse(mapped.status, mapped.code, mapped.message);
    }
  }),
};
