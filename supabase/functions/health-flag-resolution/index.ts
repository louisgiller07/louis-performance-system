// P0-SAFE (HPM 2026-10-12) — health-flag-resolution Edge Function: the rider explicitly closes one of
// their own open health signals (injury / illness / persistent pain) under the closure policy of
// ./resolveHealthFlag.ts: a declaration for a simple signal, an attested professional clearance for a
// grave one (A2 / A4), every zone confirmed for a multi-zone signal; `inspect: true` only returns what the
// closure will require. Same auth boundary as abandon-training-plan: athleteId resolved via the RLS-scoped
// client only, the write made through the admin client. Never a medical validation; concussion refused (A5).
import { withSupabase } from "@supabase/server";
import { inspectHealthFlag, resolveHealthFlag, zurichToday, type HealthFlagEvidence } from "./resolveHealthFlag.ts";
import { isWritesSuspended, writesSuspendedResponse, WRITES_SUSPENDED_ENV } from "../_shared/writesSuspended.ts";

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BODY_KEYS = ["flagId", "inspect", "professionalConsulted", "professionalClearance", "confirmedZones"];
const ZONE_FORMAT = /^[A-Za-z_]{1,40}$/;

function errorResponse(status: number, code: string, message: string, detail?: unknown): Response {
  return Response.json({ error: { code, message, ...(detail !== undefined ? { detail } : {}) } }, { status });
}

/** What the web needs to ask for: the zones to confirm and whether a clearance attestation is required. */
function requirements(evidence: HealthFlagEvidence) {
  return { zones: evidence.zones, requiresProfessionalClearance: evidence.requiresProfessionalClearance };
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
    for (const key of ["inspect", "professionalConsulted", "professionalClearance"]) {
      if (record[key] !== undefined && typeof record[key] !== "boolean") {
        return errorResponse(400, "invalid_request", `${key} must be a boolean when present.`);
      }
    }
    const confirmedZones = record.confirmedZones;
    if (confirmedZones !== undefined && (!Array.isArray(confirmedZones) || confirmedZones.length > 40 || !confirmedZones.every((z) => typeof z === "string" && ZONE_FORMAT.test(z)))) {
      return errorResponse(400, "invalid_request", "confirmedZones must be an array of zone codes when present.");
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
      if (record.inspect === true) {
        const inspected = await inspectHealthFlag(ctx.supabaseAdmin, athleteId, record.flagId);
        switch (inspected.status) {
          case "ok":
            return Response.json({ flagId: record.flagId, requirements: requirements(inspected.evidence) }, { status: 200 });
          case "not_found":
            return errorResponse(404, "health_flag_not_found", "This health signal does not exist.");
          case "already_resolved":
            return errorResponse(409, "health_flag_already_resolved", "This health signal is already closed.");
          case "medical_validation_required":
            return errorResponse(409, "medical_validation_required", "This health signal can only be closed after a medical validation.");
        }
      }
      const outcome = await resolveHealthFlag(ctx.supabaseAdmin, athleteId, record.flagId, {
        resolvedAt: zurichToday(),
        professionalConsulted: record.professionalConsulted === true,
        professionalClearance: record.professionalClearance === true,
        confirmedZones: confirmedZones as string[] | undefined,
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
        case "professional_clearance_required":
          return errorResponse(409, "professional_clearance_required", "This health signal needs an attested professional clearance to be closed.", requirements(outcome.evidence));
        case "zones_confirmation_required":
          return errorResponse(409, "zones_confirmation_required", "Every zone of this health signal must be confirmed to close it.", requirements(outcome.evidence));
      }
    } catch (error) {
      console.error(`health-flag-resolution: failed [${error instanceof Error ? error.name : typeof error}]`);
      return errorResponse(500, "internal_error", "Failed to close the health signal.");
    }
  }),
};
