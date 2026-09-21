/**
 * `acceptTrainingPlanVersion` — application-level "accept a plan" flow
 * (V0.4_014, ADR V0.4_012's revised accept-flow decision). Composes two
 * already-existing, unmodified pieces — the `accept_training_plan_version`
 * RPC and the `projectTrainingPlan` orchestrator — as two separate,
 * sequential operations, never one SQL transaction:
 *
 *   accept RPC succeeds -> await -> projectTrainingPlan() -> return result
 *
 * This is deliberate, not a shortcut: `session_type` derivation lives in
 * TypeScript (frozen mapping, ADR V0.4_012), so a pure-SQL, same-transaction
 * extension of `accept_training_plan_version` was rejected. The gap this
 * opens — a crash between the two calls leaves an accepted-but-unprojected
 * plan — is not new risk: the daily rolling projection (not wired yet,
 * separate ticket) already tolerates and self-heals exactly this state
 * (M2.5 §K). Consistent with that tolerance, a projection failure here is
 * surfaced as a warning, never as a reason to treat acceptance itself as
 * failed.
 *
 * Not wired into any caller yet (no edge function, no web action) — see
 * ADR V0.4_012/V0.4_013 and the V0.4_014 audit: no such entry point exists
 * today. This module is a standalone, independently callable/testable unit,
 * same status as `projectTrainingPlan.ts` before it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptTrainingPlanVersionRpc, type AcceptTrainingPlanVersionResult } from "./acceptTrainingPlanVersionRpc.js";
import { projectTrainingPlan, type ProjectionReport } from "./projectTrainingPlan.js";

export interface AcceptTrainingPlanVersionOutcome {
  acceptance: AcceptTrainingPlanVersionResult;
  /** `undefined` exactly when projection failed — see `warnings` for why. Acceptance itself is never rolled back or otherwise treated as failed because of a projection failure. */
  projection: ProjectionReport | undefined;
  warnings: string[];
}

/**
 * Injectable seam — same reasoning as RunDailyForDeps/ProjectTrainingPlanDeps:
 * lets orchestration (call counts, exact arguments, and specifically
 * "acceptance failure must prevent the projection call entirely") be
 * unit-tested with plain mocks, without a live DB.
 */
export interface AcceptTrainingPlanVersionDeps {
  acceptTrainingPlanVersionRpc: typeof acceptTrainingPlanVersionRpc;
  projectTrainingPlan: typeof projectTrainingPlan;
}

const DEFAULT_DEPS: AcceptTrainingPlanVersionDeps = {
  acceptTrainingPlanVersionRpc,
  projectTrainingPlan,
};

/**
 * Accepts `planVersionId` for `athleteId`, then projects
 * `[windowStart, windowEnd]` onto `planned_sessions`/`training_blocks`.
 *
 * `windowStart`/`windowEnd` are the caller's own responsibility — the
 * rolling-window size remains an undecided product parameter (ADR
 * V0.4_012/M2.6/M2.7); this orchestrator never invents a default for it.
 *
 * If the accept RPC itself throws, this function throws too — acceptance
 * failure prevents the projection call outright, `projectTrainingPlan` is
 * never invoked. If acceptance succeeds but projection throws, the error is
 * caught, added to `warnings`, and `projection` is `undefined` on the
 * returned outcome — this function still resolves normally.
 */
export async function acceptTrainingPlanVersion(
  client: SupabaseClient,
  athleteId: string,
  planVersionId: string,
  windowStart: string,
  windowEnd: string,
  deps: AcceptTrainingPlanVersionDeps = DEFAULT_DEPS
): Promise<AcceptTrainingPlanVersionOutcome> {
  const acceptance = await deps.acceptTrainingPlanVersionRpc(client, athleteId, planVersionId);

  try {
    const projection = await deps.projectTrainingPlan(client, athleteId, windowStart, windowEnd);
    return { acceptance, projection, warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      acceptance,
      projection: undefined,
      warnings: [`Projection after plan acceptance failed and was skipped: ${message}`],
    };
  }
}
