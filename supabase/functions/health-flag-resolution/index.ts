// P0-SAFE (HPM 2026-10-12) — health-flag-resolution Edge Function: the rider explicitly closes one of
// their own open health signals (injury / illness / persistent pain) once the pain or the symptoms are
// gone. Same auth boundary as abandon-training-plan: withSupabase, athleteId resolved via the RLS-scoped
// client only, the write made through the admin client by ./resolveHealthFlag.ts (self-contained: no
// head-coach-engine/dist import). Never a medical validation; a concussion signal is refused (A5).
import { withSupabase } from "@supabase/server";
import { resolveHealthFlag, zurichToday } from "./resolveHealthFlag.ts";
import { isWritesSuspended, writesSuspendedResponse, WRITES_SUSPENDED_ENV } from "../_shared/writesSuspended.ts";

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BODY_KEYS = ["flagId", "professionalConsulted"];

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
    if (isWritesSuspended(Deno.env.get(WRITES_SUSPENDED_ENV))) {
      return writesSuspendedResponse();
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
    const record = body as Record<string, unknown>;
    const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_BODY_KEYS.includes(key));
    if (unknownKeys.length > 0) {
      return errorResponse(400, "invalid_request", `Unknown propert${unknownKeys.length === 1 ? "y" : "ies"}: ${unknownKeys.join(", ")}.`);
    }
    if (typeof record.flagId !== "string" || !UUID_FORMAT.test(record.flagId)) {
      return errorResponse(400, "invalid_request", "flagId is required and must be a valid UUID.");
    }
    if (record.professionalConsulted !== undefined && typeof record.professionalConsulted !== "boolean") {
      return errorResponse(400, "invalid_request", "professionalConsulted must be a boolean when present.");
    }

    // RLS-scoped resolution of the caller's athlete — never a client-supplied id.
    const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
    if (athleteError) {
      console.error(`health-flag-resolution: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }
    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }
    if (athletes.length > 1) {
      console.error("health-flag-resolution: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }
    const athleteId = athletes[0].id as string;

    try {
      const outcome = await resolveHealthFlag(ctx.supabaseAdmin, athleteId, record.flagId, {
        professionalConsulted: record.professionalConsulted === true,
        resolvedAt: zurichToday(),
      });
      switch (outcome.status) {
        case "resolved":
          console.info(`health-flag-resolution: resolved ${outcome.flagType}`);
          return Response.json({ flagId: outcome.flagId, status: "resolved", resolvedAt: outcome.resolvedAt }, { status: 200 });
        case "not_found":
          return errorResponse(404, "health_flag_not_found", "This health signal does not exist.");
        case "already_resolved":
          return errorResponse(409, "health_flag_already_resolved", "This health signal is already closed.");
        case "medical_validation_required":
          return errorResponse(409, "medical_validation_required", "This health signal can only be closed after a medical validation.");
      }
    } catch (error) {
      console.error(`health-flag-resolution: failed [${error instanceof Error ? error.name : typeof error}]`);
      return errorResponse(500, "internal_error", "Failed to close the health signal.");
    }
  }),
};
