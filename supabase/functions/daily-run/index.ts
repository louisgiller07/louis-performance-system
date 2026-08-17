// M3_003 — wires the M3_002 auth boundary to the real M1/M2 engine. See
// docs/11_DECISION_LOG.md (M3_001 / M3_002 / M3_003). Imports the compiled
// head-coach-engine/dist output (M3_001-proven boundary), never the M1/M2
// TypeScript source, and never head-coach-engine/src/supabase/client.ts —
// ctx.supabaseAdmin (from @supabase/server) is the client passed to
// runDailyFor.
import { withSupabase } from "@supabase/server";
import { runDailyFor } from "../../../head-coach-engine/dist/supabase/runDailyFor.js";
import { mapDailyRunError } from "./errorMapping.ts";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_BODY_KEYS = ["date"];

function isValidCalendarDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // Round-trip through Date.UTC to reject roll-over dates (e.g. 2026-02-30
  // would silently become 2026-03-02 if we trusted the constructor alone).
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

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

    const dateValue = (body as Record<string, unknown>).date;
    if (typeof dateValue !== "string" || !isValidCalendarDate(dateValue)) {
      return errorResponse(400, "invalid_request", "date is required and must be a valid calendar date in YYYY-MM-DD format.");
    }

    // Athlete resolution goes through the RLS-scoped `ctx.supabase` client,
    // never `ctx.supabaseAdmin` — this is the whole point of M3_002: prove
    // the caller's athlete is resolved via RLS, not a client-supplied id.
    const { data: athletes, error: athleteError } = await ctx.supabase
      .from("athletes")
      .select("id");

    if (athleteError) {
      console.error(`daily-run: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }

    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }

    if (athletes.length > 1) {
      // Defensive: athletes.user_id is UNIQUE, so this should be
      // unreachable. Refuse to arbitrarily pick a row rather than silently
      // proceeding with the wrong athlete.
      console.error("daily-run: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }

    const athleteId = athletes[0].id as string;

    try {
      // ctx.supabaseAdmin only — athleteId came exclusively from the
      // RLS-scoped ctx.supabase query above, never from client input.
      const result = await runDailyFor(ctx.supabaseAdmin, athleteId, dateValue);
      return Response.json(
        {
          dailyPlan: result.dailyPlan,
          decisionId: result.persistence.decision_id,
          healthFlagId: result.persistence.health_flag_id,
          warnings: result.warnings,
        },
        { status: 200 }
      );
    } catch (error) {
      const mapped = mapDailyRunError(error);
      console.error(`daily-run: runDailyFor failed [${error instanceof Error ? error.name : typeof error}] -> ${mapped.code}`);
      return errorResponse(mapped.status, mapped.code, mapped.message);
    }
  }),
};
