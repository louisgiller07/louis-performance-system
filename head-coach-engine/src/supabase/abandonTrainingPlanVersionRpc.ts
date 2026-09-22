/**
 * Typed wrapper around the `abandon_training_plan_version` RPC
 * (supabase/migrations/20260922100000_v0_4_005a_abandon_training_plan_
 * version_rpc.sql). Same style as acceptTrainingPlanVersionRpc.ts /
 * projectTrainingPlanRpc.ts — one RPC call, an explicit runtime parser that
 * never blind-casts the returned JSON, custom error classes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AbandonTrainingPlanVersionResult {
  planVersionId: string;
  idempotentReplay: boolean;
  /** Absent exactly when idempotentReplay is true — the RPC omits this key entirely on a replay, never sets it to null. */
  abandonedTransitionId?: string;
}

export class AbandonTrainingPlanVersionRpcError extends Error {
  constructor(message: string) {
    super(`abandon_training_plan_version RPC call failed: ${message}`);
    this.name = "AbandonTrainingPlanVersionRpcError";
  }
}

export class InvalidAbandonTrainingPlanVersionResultError extends Error {
  constructor(reason: string, value: unknown) {
    super(`abandon_training_plan_version returned an invalid result: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidAbandonTrainingPlanVersionResultError";
  }
}

/**
 * Validates the RPC's raw JSON result at runtime. Never casts blindly:
 * a missing/non-string `plan_version_id`, a missing/non-boolean
 * `idempotent_replay`, or an `abandoned_transition_id` that is present but
 * not a string are all rejected explicitly.
 */
export function parseAbandonTrainingPlanVersionResult(data: unknown): AbandonTrainingPlanVersionResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidAbandonTrainingPlanVersionResultError("expected a JSON object", data);
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.plan_version_id !== "string") {
    throw new InvalidAbandonTrainingPlanVersionResultError("plan_version_id is missing or not a string", data);
  }
  if (typeof obj.idempotent_replay !== "boolean") {
    throw new InvalidAbandonTrainingPlanVersionResultError("idempotent_replay is missing or not a boolean", data);
  }
  if (obj.abandoned_transition_id !== undefined && typeof obj.abandoned_transition_id !== "string") {
    throw new InvalidAbandonTrainingPlanVersionResultError("abandoned_transition_id is present but not a string", data);
  }

  return {
    planVersionId: obj.plan_version_id,
    idempotentReplay: obj.idempotent_replay,
    ...(obj.abandoned_transition_id !== undefined ? { abandonedTransitionId: obj.abandoned_transition_id } : {}),
  };
}

/** Invokes `abandon_training_plan_version` exactly once. */
export async function abandonTrainingPlanVersionRpc(
  client: SupabaseClient,
  athleteId: string,
  planVersionId: string,
  reason: string
): Promise<AbandonTrainingPlanVersionResult> {
  const { data, error } = await client.rpc("abandon_training_plan_version", {
    p_athlete_id: athleteId,
    p_plan_version_id: planVersionId,
    p_reason: reason,
  });

  if (error) throw new AbandonTrainingPlanVersionRpcError(error.message);

  return parseAbandonTrainingPlanVersionResult(data);
}
