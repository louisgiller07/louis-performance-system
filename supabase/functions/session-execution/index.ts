// UX-11B.2.2 — record a session execution (lifecycle events + set results).
//
// POST /functions/v1/session-execution  -> one atomic batch
//   { execution?, events?, sets? } recorded through record_session_execution
//   (supabase/migrations/20260930120500_ux11b2_record_session_execution.sql).
//
// LOCAL ONLY for now: not deployed until UX-11A.5 (engines write the day's
// v2 prescription) and UX-11C (session mode) — see docs/11_DECISION_LOG.md
// (ADR UX-11B.2.1, §12 Déploiement).
//
// Reads never go through this function: the web reads its own rows directly
// through RLS (*_own_select policies), like the rest of the app.
// Consent: checked by the web client today, like every other write path
// (ADR UX-11B.2.1 §7); a server-side check is a separate security ticket.
// CORS/OPTIONS: answered by the gateway, same as the other functions.
import { withSupabase } from "@supabase/server";
import { REJECTION_STATUS, validateSessionExecutionBody } from "./validation.ts";

function errorResponse(status: number, code: string, message: string, target?: string): Response {
  return Response.json({ error: { code, message, ...(target ? { target } : {}) } }, { status });
}

const REJECTION_MESSAGES: Readonly<Record<string, string>> = {
  invalid_payload: "The batch is not valid.",
  execution_not_found: "This session execution does not exist.",
  prescription_not_found: "This prescription does not exist.",
  id_conflict: "This id was already recorded with different content.",
  active_execution_exists: "Another session execution is already in progress for this day.",
  invalid_transition: "This lifecycle event is not allowed at this point of the session.",
  invalid_correction: "This correction is not allowed.",
  missing_start_event: "A new session execution must include its started event.",
  not_executable: "This prescription cannot be executed set by set.",
  date_mismatch: "The prescription does not belong to this day.",
  invalid_item: "This exercise is not part of the prescription.",
  measure_mismatch: "This measure does not match the prescribed exercise.",
  invalid_prescribed_measure: "The prescribed exercise has no valid measure.",
  final_prescription_not_current: "This prescription is no longer today's current prescription.",
  activity_not_allowed_by_prescription: "This activity is not one of the activities the prescription allows.",
  activity_result_exists: "An activity was already recorded for this session; send a correction instead.",
  activity_result_required: "Record the activity performed before completing this session.",
  execution_terminal: "This session is already completed or stopped: its results can no longer change.",
  result_slot_out_of_range: "This set or pass number is outside what the prescription plans.",
  result_slot_exists: "A result was already recorded for this set or pass; send a correction instead.",
};

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json(
        { error: { code: "method_not_allowed", message: "Only POST is supported on this endpoint." } },
        { status: 405, headers: { Allow: "POST" } }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON.");
    }

    const validation = validateSessionExecutionBody(rawBody);
    if (!validation.ok) {
      return errorResponse(400, validation.error.code, validation.error.message);
    }

    // Athlete resolution — RLS-scoped ctx.supabase only, never a client-supplied id.
    const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
    if (athleteError) {
      console.error(`session-execution: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }
    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }
    if (athletes.length > 1) {
      console.error("session-execution: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }
    const athleteId = athletes[0].id as string;

    const { data: result, error: rpcError } = await ctx.supabaseAdmin.rpc("record_session_execution", {
      p_athlete_id: athleteId,
      p_payload: validation.value,
    });
    if (rpcError) {
      // Unexpected / environmental: business rejections never raise (they
      // come back as { status: "rejected" }), so nothing to reinterpret here.
      console.error(`session-execution: record_session_execution failed [${rpcError.code}]`);
      return errorResponse(500, "persistence_failed", "Failed to record the session execution.");
    }

    const outcome = result as { status?: unknown; code?: unknown; target?: unknown; inserted?: unknown; unchanged?: unknown } | null;
    if (outcome?.status === "ok") {
      return Response.json({ inserted: outcome.inserted, unchanged: outcome.unchanged }, { status: 200 });
    }
    if (outcome?.status === "rejected" && typeof outcome.code === "string" && outcome.code in REJECTION_STATUS) {
      return errorResponse(
        REJECTION_STATUS[outcome.code],
        outcome.code,
        REJECTION_MESSAGES[outcome.code] ?? "The batch was rejected.",
        typeof outcome.target === "string" ? outcome.target : undefined
      );
    }
    console.error("session-execution: record_session_execution returned an unexpected shape");
    return errorResponse(500, "internal_error", "An unexpected error occurred while recording the session execution.");
  }),
};
