/**
 * UX-11R.9 (R9-OPS-01) — rollout write suspension for the three mutating Edge
 * Functions (session-execution, completed-session PUT, accept-training-plan).
 * Read by each handler from the Edge secret NALYNT_WRITES_SUSPENDED: exactly
 * "true" → the request is answered 503 `writes_suspended` before any write
 * (no RPC, no row, no lifecycle or observability event). Absent, "false" or
 * any other value → normal behaviour (never fail-closed: the bundles are
 * deployed before the suspension is switched on). daily-run is not concerned.
 *
 * Pure: no Deno-specific API, so the rule is unit-tested under Node (vitest).
 * Not a general maintenance system: it only gates these three write paths
 * during the UX-11R.9 transition (Edge → DB → web).
 */

export const WRITES_SUSPENDED_ENV = "NALYNT_WRITES_SUSPENDED";
export const WRITES_SUSPENDED_CODE = "writes_suspended";
/** Neutral rider-facing wording: nothing about maintenance internals. */
export const WRITES_SUSPENDED_MESSAGE = "Les modifications sont temporairement indisponibles. Réessaie dans quelques instants.";

export function isWritesSuspended(value: string | undefined | null): boolean {
  return value === "true";
}

/** Same `{ error: { code, message } }` shape as every other error of these three functions. */
export function writesSuspendedResponse(): Response {
  return Response.json({ error: { code: WRITES_SUSPENDED_CODE, message: WRITES_SUSPENDED_MESSAGE } }, { status: 503 });
}
