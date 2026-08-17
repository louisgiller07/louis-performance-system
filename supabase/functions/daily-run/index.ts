// M3_002 — auth boundary + athlete resolution stub. Does NOT call
// runDailyFor yet (see docs/11_DECISION_LOG.md, M3_001 / M3_002). This is
// intentionally a thin auth+validation layer proven in isolation before
// M3_003 wires in the engine.
import { withSupabase } from "@supabase/server";

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

    return Response.json({ ok: true, date: dateValue }, { status: 200 });
  }),
};
