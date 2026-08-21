// M5_003 — authenticated post-session logging.
//
// GET  /functions/v1/completed-session?date=YYYY-MM-DD  -> the caller's own
//      completed_sessions row for that date, or { completedSession: null }
//      (never 404 for normal absence).
// PUT  /functions/v1/completed-session                  -> strict
//      full-replacement upsert via the frozen persist_completed_session RPC
//      (M5_001A, unchanged here — see
//      supabase/migrations/20260819210000_persist_completed_session_rpc.sql).
//
// CORS/OPTIONS: verified empirically against daily-run (M5_003 audit) that
// the Kong gateway in front of every deployed function already answers
// OPTIONS with full Access-Control-* headers before this handler ever
// runs — no function-level CORS code exists on daily-run, and none is
// added here either, for the same reason.
//
// See docs/11_DECISION_LOG.md (M5_003) for the full design record,
// including why `free_notes` (a real, required-present RPC key) is
// deliberately never part of this endpoint's client-facing contract — it
// is never read from or exposed to the client, but its existing persisted
// value (if any) IS preserved server-side across a full-replacement PUT
// (see the pre-RPC lookup below), since the RPC's full-replacement
// semantics would otherwise silently null it out on every edit.
import { withSupabase } from "@supabase/server";
import { validateCompletedSessionBody, validateDateParam } from "./validation.ts";
import { classifyMissingReadback } from "./apiErrors.ts";

const ALLOWED_METHODS = "GET, PUT";

// A single string literal (not built via `+`) — matches this project's
// established supabase-js convention (see e.g. web/src/features/checkin/checkinRepo.ts)
// so the typed query builder can shape .select()'s return type.
const CANONICAL_READBACK_COLUMNS =
  "id, session_date, decision_id, session_type, completion_status, actual_duration_min, rpe, post_leg_fatigue, post_grip_fatigue, new_pain, new_pain_note, intervention, main_content, session_load, updated_at";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const url = new URL(req.url);

    if (req.method !== "GET" && req.method !== "PUT") {
      return Response.json(
        { error: { code: "method_not_allowed", message: `Only ${ALLOWED_METHODS} are supported on this endpoint.` } },
        { status: 405, headers: { Allow: ALLOWED_METHODS } }
      );
    }

    if (req.method === "GET") {
      const dateResult = validateDateParam(url.searchParams.get("date"));
      if (!dateResult.ok) {
        return errorResponse(400, dateResult.error.code, dateResult.error.message);
      }

      // Athlete resolution — identical pattern to daily-run: the
      // RLS-scoped ctx.supabase client only, never a client-supplied id.
      const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
      if (athleteError) {
        console.error(`completed-session: athlete resolution failed [${athleteError.code}]`);
        return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
      }
      if (!athletes || athletes.length === 0) {
        return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
      }
      if (athletes.length > 1) {
        console.error("completed-session: multiple athletes resolved for a single user; refusing to pick one");
        return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
      }
      const athleteId = athletes[0].id as string;

      // RLS (completed_sessions_own_select) already scopes this to the
      // caller's own rows; the explicit athlete_id filter is defense in
      // depth, matching the same belt-and-suspenders convention used
      // elsewhere in this project (never relying on RLS alone).
      const { data: row, error } = await ctx.supabase
        .from("completed_sessions")
        .select(CANONICAL_READBACK_COLUMNS)
        .eq("athlete_id", athleteId)
        .eq("session_date", dateResult.value)
        .maybeSingle();

      if (error) {
        console.error(`completed-session: GET read failed [${error.code}]`);
        return errorResponse(500, "internal_error", "Failed to read the completed session.");
      }

      return Response.json({ completedSession: row ?? null }, { status: 200 });
    }

    // PUT
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON.");
    }

    const validation = validateCompletedSessionBody(rawBody);
    if (!validation.ok) {
      return errorResponse(400, validation.error.code, validation.error.message);
    }
    const body = validation.value;

    const { data: athletes, error: athleteError } = await ctx.supabase.from("athletes").select("id");
    if (athleteError) {
      console.error(`completed-session: athlete resolution failed [${athleteError.code}]`);
      return errorResponse(500, "internal_error", "Failed to resolve athlete for the authenticated user.");
    }
    if (!athletes || athletes.length === 0) {
      return errorResponse(403, "no_athlete_for_user", "No athlete record exists for the authenticated user.");
    }
    if (athletes.length > 1) {
      console.error("completed-session: multiple athletes resolved for a single user; refusing to pick one");
      return errorResponse(500, "internal_error", "Ambiguous athlete resolution for the authenticated user.");
    }
    const athleteId = athletes[0].id as string;

    // free_notes preservation — RLS-scoped, read-only. free_notes is not
    // part of the M5_003 client contract (see module doc above): the
    // browser never sees or sets it. But persist_completed_session is a
    // strict full-replacement upsert, so blindly sending `null` here would
    // silently destroy an existing non-null free_notes value on every edit
    // that only touches a visible field like RPE. CREATE (no prior row) ->
    // null. EDIT (prior row exists) -> its exact existing value, verbatim.
    const { data: existingRow, error: existingRowError } = await ctx.supabase
      .from("completed_sessions")
      .select("free_notes")
      .eq("athlete_id", athleteId)
      .eq("session_date", body.session_date)
      .maybeSingle();

    if (existingRowError) {
      console.error(`completed-session: existing-row lookup failed [${existingRowError.code}]`);
      return errorResponse(500, "internal_error", "Failed to check for an existing completed session.");
    }
    const preservedFreeNotes = existingRow?.free_notes ?? null;

    // Decision-link preflight — RLS-scoped, proves the decision is both
    // visible to this user and dated exactly session_date, before any RPC
    // call is attempted. Row presence alone is the proof (RLS already
    // restricts visibility to the caller's own decisions); no separate
    // athlete_id filter is needed on top. The RPC re-validates this
    // authoritatively regardless (defense in depth, service_role side) —
    // this preflight exists to produce a specific 422 without ever parsing
    // the RPC's own PostgreSQL exception text, and to avoid a wasted
    // service-role write attempt for an input we can already tell is wrong.
    //
    // `final_session` is also read here (M5_003 final review) to check
    // planned-vs-actual coherence: for done/partial/skipped, session_type
    // represents the planned/attempted session and must equal the linked
    // decision's coarse final_session — a different coarse type there
    // proves a real inconsistency. This is a distinct failure from "the
    // decision doesn't exist/isn't yours/isn't dated right"
    // (decision_link_invalid) — a violated planned-vs-actual relationship
    // gets its own code (decision_session_mismatch) so the two are never
    // conflated.
    //
    // For `replaced`, NO comparison is made at all (M5_003 second final
    // review — the original equality-must-differ rule was removed as
    // over-constrained): decisions.final_session and
    // completed_sessions.session_type are both coarse DB session types,
    // and multiple distinct rich TrainingInterventions can map to the same
    // coarse type (e.g. a planned MOBILITY intervention and an actual
    // DH_LIGHT replacement both coarsen to RECOVERY — see
    // head-coach-engine/src/mapping/trainingInterventionToDbSessionType.ts).
    // Coarse-type equality therefore does NOT prove the session wasn't
    // replaced; M5_003 does not capture enough rich intervention detail to
    // tell the two cases apart, and `completion_status = replaced` is
    // already the athlete's own explicit declaration of what happened —
    // never second-guessed from coarse-type equality alone.
    if (body.decision_id !== null) {
      const { data: decisionRow, error: decisionError } = await ctx.supabase
        .from("decisions")
        .select("id, final_session")
        .eq("id", body.decision_id)
        .eq("decision_date", body.session_date)
        .maybeSingle();

      if (decisionError) {
        console.error(`completed-session: decision preflight failed [${decisionError.code}]`);
        return errorResponse(500, "internal_error", "Failed to validate the linked decision.");
      }
      if (!decisionRow) {
        return errorResponse(422, "decision_link_invalid", "decision_id must reference your own decision dated exactly session_date.");
      }

      if (body.completion_status !== "replaced") {
        const plannedSession = decisionRow.final_session as string;
        if (body.session_type !== plannedSession) {
          return errorResponse(
            422,
            "decision_session_mismatch",
            "For this completion_status, session_type must match the linked decision's planned session."
          );
        }
      }
    }

    const { data: rpcResult, error: rpcError } = await ctx.supabaseAdmin.rpc("persist_completed_session", {
      p_athlete_id: athleteId,
      p_row: {
        session_date: body.session_date,
        decision_id: body.decision_id,
        session_type: body.session_type,
        completion_status: body.completion_status,
        actual_duration_min: body.actual_duration_min,
        rpe: body.rpe,
        main_content: body.main_content,
        intervention: body.intervention,
        // Preserved server-side (see the lookup above) — never the
        // client's to set. The RPC still requires the key present on every
        // call (full-replacement contract).
        free_notes: preservedFreeNotes,
        post_leg_fatigue: body.post_leg_fatigue,
        post_grip_fatigue: body.post_grip_fatigue,
        new_pain: body.new_pain,
        new_pain_note: body.new_pain_note,
      },
    });

    if (rpcError) {
      // Never parsed or classified beyond this generic code — see
      // docs/11_DECISION_LOG.md (M5_003) for why: our own preflight above
      // already rules out the expected rejection paths, so a failure here
      // is unexpected/environmental, not something to reinterpret from
      // PostgreSQL's human-readable exception text.
      console.error(`completed-session: persist_completed_session RPC failed [${rpcError.code}]`);
      return errorResponse(500, "persistence_failed", "Failed to persist the completed session.");
    }

    const completedSessionId = (rpcResult as { completed_session_id?: unknown } | null)?.completed_session_id;
    if (typeof completedSessionId !== "string") {
      console.error("completed-session: persist_completed_session returned an unexpected shape");
      return errorResponse(500, "internal_error", "An unexpected error occurred while persisting the completed session.");
    }

    // Canonical readback — RLS-scoped, proves ownership independently of
    // the service-role write that just happened. Never fabricated from the
    // PUT request body (session_load in particular is DB-derived and could
    // not be known client-side).
    const { data: readbackRow, error: readbackError } = await ctx.supabase
      .from("completed_sessions")
      .select(CANONICAL_READBACK_COLUMNS)
      .eq("id", completedSessionId)
      .eq("athlete_id", athleteId)
      .eq("session_date", body.session_date)
      .maybeSingle();

    if (readbackError) {
      console.error(`completed-session: readback failed [${readbackError.code}]`);
      return errorResponse(500, "internal_error", "Failed to read back the persisted completed session.");
    }
    if (!readbackRow) {
      console.error("completed-session: readback returned no row after a successful RPC write");
      const missing = classifyMissingReadback();
      return errorResponse(missing.status, missing.code, missing.message);
    }

    return Response.json({ completedSession: readbackRow, warnings: [] }, { status: 200 });
  }),
};
