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
