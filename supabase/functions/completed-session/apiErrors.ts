/**
 * Small, portable (zero Deno-specific APIs) response-shaping helpers for
 * outcomes that are hard or undesirable to trigger empirically through the
 * public HTTP contract — extracted so index.ts's handler branch calls into
 * code a plain Node/vitest unit test can exercise directly (see
 * tests/apiErrors.test.ts), rather than the branch's correctness resting
 * only on a real HTTP request that no test can deterministically force.
 */

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

/**
 * The exact public shape for "the persist_completed_session RPC succeeded,
 * but the immediate RLS-scoped readback found no row" — a defensive branch
 * (same category as daily-run's own untested ">1 athlete" case) that the
 * public API has no deterministic way to force via HTTP alone. Takes no
 * argument: nothing dynamic (athleteId, completed_session_id, SQL, raw RPC
 * exception text) can leak into this response by construction — the
 * handler must never build this response by hand at the call site.
 */
export function classifyMissingReadback(): ApiError {
  return {
    status: 500,
    code: "persistence_readback_missing",
    message: "The completed session was saved but could not be read back.",
  };
}

/**
 * UX-11R.9 (F-5, F-5b) — a legacy completed_sessions row is refused for a
 * date whose guided V2 execution is open (started / paused / resumed) or
 * completed (one main session per athlete and day). HTTP 409. The RPC guard
 * (migration 20261005120500) raises this dedicated SQLSTATE; the handler
 * maps the code, never the message text.
 */
export const COMPLETED_SESSION_V2_EXISTS = "completed_session_v2_exists";
export const COMPLETED_SESSION_V2_EXISTS_SQLSTATE = "NX101";
export const COMPLETED_SESSION_V2_EXISTS_MESSAGE = "This day's session was already completed as a guided session: no separate debrief can be recorded for it.";

/**
 * UX-11R.9 (F-5b) — the day's guided executions (each with its lifecycle
 * events) include one that is not abandoned: open or completed. Pure, so
 * the precheck rule is unit-tested; the same rule as the RPC guard.
 */
export function hasNonAbandonedExecution(executions: ReadonlyArray<{ execution_events?: ReadonlyArray<{ event_type?: unknown }> | null }>): boolean {
  return executions.some((execution) => !(execution.execution_events ?? []).some((event) => event.event_type === "abandoned"));
}

/**
 * INT-01 (HPM 2026-10-13) — the RPC's health guard (migration 20261013180000): a debrief the day's health state
 * forbids is a business refusal, HTTP 409 with its own code (never a 500, never the message text).
 *   NX102 health_suspended            — « Terminée », « Partielle » or « Remplacée » under a health suspension, or
 *                                        for a guided attempt stopped on a day with a Safety REST.
 *   NX103 daily_decision_not_current  — the day's analysis must run again (check-in changed) before the debrief.
 *   NX104 guided_results_exist        — « Non réalisée » would contradict guided results already recorded that day.
 */
export const HEALTH_GUARD_REFUSALS: Readonly<Record<string, ApiError>> = {
  NX102: { status: 409, code: "health_suspended", message: "Training is suspended for health reasons on this day: the session cannot be recorded as performed." },
  NX103: { status: 409, code: "daily_decision_not_current", message: "Today's check-in changed: today's analysis must run again before the debrief." },
  NX104: { status: 409, code: "guided_results_exist", message: "Guided session results were recorded on this day: it cannot be recorded as not performed." },
};

/** The business refusal for a persist_completed_session SQLSTATE, or null (an unexpected failure stays a 500). */
export function classifyHealthGuardRefusal(sqlstate: string | undefined): ApiError | null {
  return sqlstate !== undefined && Object.prototype.hasOwnProperty.call(HEALTH_GUARD_REFUSALS, sqlstate) ? HEALTH_GUARD_REFUSALS[sqlstate]! : null;
}

