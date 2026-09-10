// Calls the real remote Edge Function supabase/functions/completed-session.
// GET and PUT both go through supabase.functions.invoke — never a direct
// `.from("completed_sessions")` write from the browser (RLS only grants
// authenticated SELECT since M5_001A; the only legitimate write path is
// this Edge Function's service-role RPC call). GET could technically use a
// direct RLS SELECT instead, but goes through the same Edge Function for a
// single canonical response shape — see docs/11_DECISION_LOG.md (M5_003).
//
// `functions.invoke` with `method: "GET"` and the date folded into the
// function-name string (not a `query` option) — the installed
// @supabase/supabase-js (2.112.3) FunctionInvokeOptions has no dedicated
// query-param option; `functionName` is concatenated into `new URL(...)`
// internally, so a query string embedded there parses correctly. This is
// the smallest existing-SDK-compatible mechanism (see M5_003 audit) —
// deliberately not a raw `fetch` with manually-attached auth headers.
import { supabase } from "../../lib/supabase";
import { mapCompletedSessionError, type CompletedSessionError } from "./completedSessionErrors";
import type { CompletedSessionInput, CompletedSessionRecord } from "./completedSessionTypes";
import { COMPLETION_STATUSES, SESSION_TYPES } from "./completedSessionTypes";
import { isLoadProfile } from "./performedInterventionTypes";

export type GetCompletedSessionResult =
  | { ok: true; data: CompletedSessionRecord | null }
  | { ok: false; error: CompletedSessionError };

export type PutCompletedSessionResult =
  | { ok: true; data: { completedSession: CompletedSessionRecord; warnings: string[] } }
  | { ok: false; error: CompletedSessionError };

const INVALID_RESPONSE_ERROR: CompletedSessionError = {
  code: "invalid_response",
  message: "Réponse du serveur invalide. Réessaie.",
  retryable: true,
  action: "retry",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A JSON object, never an array — matches the Edge Function's own intervention/main_content validation (supabase/functions/completed-session/validation.ts: an array is never a "plain JSON object"). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * V0.3_007B — `intervention` is now read (it prefills the rich performed
 * picker on edit and is displayed in view mode), so this checks its
 * discriminant shape (`kind` a string, `load_profile` absent or a known
 * LoadProfile) rather than just "some plain object" — still a structural
 * guard, not a full re-run of validatePerformedIntervention's kind/load
 * consistency rules (that's the Edge Function/RPC's job, authoritatively).
 */
function isPerformedInterventionShape(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  if (typeof value.kind !== "string") return false;
  return value.load_profile === undefined || (typeof value.load_profile === "string" && isLoadProfile(value.load_profile));
}

/**
 * Structural guard, not a full schema validator — only what this UI
 * actually reads is checked, matching the project's established "mirror
 * only what's consumed" discipline. `main_content` is checked
 * (object-or-null, arrays rejected) even though this UI never displays its
 * contents: the edit flow blindly round-trips it in a full-replacement PUT,
 * so malformed opaque data here could otherwise either produce an invalid
 * PUT or silently erase state that was actually fine — see
 * docs/11_DECISION_LOG.md (M5_003, final review; V0.3_007B for
 * `intervention` becoming an actively-read field).
 */
function isCompletedSessionRecord(value: unknown): value is CompletedSessionRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.session_date === "string" &&
    (value.decision_id === null || typeof value.decision_id === "string") &&
    typeof value.session_type === "string" &&
    (SESSION_TYPES as readonly string[]).includes(value.session_type) &&
    typeof value.completion_status === "string" &&
    (COMPLETION_STATUSES as readonly string[]).includes(value.completion_status) &&
    (value.actual_duration_min === null || typeof value.actual_duration_min === "number") &&
    (value.rpe === null || typeof value.rpe === "number") &&
    (value.post_leg_fatigue === null || typeof value.post_leg_fatigue === "number") &&
    (value.post_grip_fatigue === null || typeof value.post_grip_fatigue === "number") &&
    typeof value.new_pain === "boolean" &&
    (value.new_pain_note === null || typeof value.new_pain_note === "string") &&
    isPerformedInterventionShape(value.intervention) &&
    (value.main_content === null || isPlainObject(value.main_content)) &&
    (value.session_load === null || typeof value.session_load === "number") &&
    typeof value.updated_at === "string"
  );
}

export async function getCompletedSession(date: string): Promise<GetCompletedSessionResult> {
  const { data, error } = await supabase.functions.invoke<unknown>(`completed-session?date=${date}`, { method: "GET" });

  if (error) return { ok: false, error: await mapCompletedSessionError(error) };
  if (!isRecord(data) || !("completedSession" in data)) return { ok: false, error: INVALID_RESPONSE_ERROR };

  const completedSession = data.completedSession;
  if (completedSession === null) return { ok: true, data: null };
  if (!isCompletedSessionRecord(completedSession)) return { ok: false, error: INVALID_RESPONSE_ERROR };

  return { ok: true, data: completedSession };
}

export async function putCompletedSession(body: CompletedSessionInput): Promise<PutCompletedSessionResult> {
  const { data, error } = await supabase.functions.invoke<unknown>("completed-session", { method: "PUT", body });

  if (error) return { ok: false, error: await mapCompletedSessionError(error) };
  if (!isRecord(data) || !isCompletedSessionRecord(data.completedSession) || !Array.isArray(data.warnings)) {
    return { ok: false, error: INVALID_RESPONSE_ERROR };
  }

  return { ok: true, data: { completedSession: data.completedSession, warnings: data.warnings as string[] } };
}
