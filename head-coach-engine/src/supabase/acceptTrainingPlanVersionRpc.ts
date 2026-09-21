/**
 * Typed wrapper around the `accept_training_plan_version` RPC
 * (supabase/migrations/20260921092500_v0_4_001f_accept_training_plan_
 * version_rpc.sql, unmodified). Same style as persistDailyRun.ts /
 * projectTrainingPlanRpc.ts — one RPC call, an explicit runtime parser that
 * never blind-casts the returned JSON, custom error classes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AcceptTrainingPlanVersionResult {
  planVersionId: string;
  idempotentReplay: boolean;
  /** Absent exactly when idempotentReplay is true — the RPC omits this key entirely on a replay, never sets it to null. */
  acceptedTransitionId?: string;
}

export class AcceptTrainingPlanVersionRpcError extends Error {
  constructor(message: string) {
    super(`accept_training_plan_version RPC call failed: ${message}`);
    this.name = "AcceptTrainingPlanVersionRpcError";
  }
}

export class InvalidAcceptTrainingPlanVersionResultError extends Error {
  constructor(reason: string, value: unknown) {
    super(`accept_training_plan_version returned an invalid result: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidAcceptTrainingPlanVersionResultError";
  }
}

/**
 * Validates the RPC's raw JSON result at runtime. Never casts blindly:
 * a missing/non-string `plan_version_id`, a missing/non-boolean
 * `idempotent_replay`, or an `accepted_transition_id` that is present but
 * not a string are all rejected explicitly.
 */
export function parseAcceptTrainingPlanVersionResult(data: unknown): AcceptTrainingPlanVersionResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidAcceptTrainingPlanVersionResultError("expected a JSON object", data);
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.plan_version_id !== "string") {
    throw new InvalidAcceptTrainingPlanVersionResultError("plan_version_id is missing or not a string", data);
  }
  if (typeof obj.idempotent_replay !== "boolean") {
    throw new InvalidAcceptTrainingPlanVersionResultError("idempotent_replay is missing or not a boolean", data);
  }
  if (obj.accepted_transition_id !== undefined && typeof obj.accepted_transition_id !== "string") {
    throw new InvalidAcceptTrainingPlanVersionResultError("accepted_transition_id is present but not a string", data);
  }

  return {
    planVersionId: obj.plan_version_id,
    idempotentReplay: obj.idempotent_replay,
    ...(obj.accepted_transition_id !== undefined ? { acceptedTransitionId: obj.accepted_transition_id } : {}),
  };
}

/** Invokes `accept_training_plan_version` exactly once. */
export async function acceptTrainingPlanVersionRpc(
  client: SupabaseClient,
  athleteId: string,
  planVersionId: string
): Promise<AcceptTrainingPlanVersionResult> {
  const { data, error } = await client.rpc("accept_training_plan_version", {
    p_athlete_id: athleteId,
    p_plan_version_id: planVersionId,
  });

  if (error) throw new AcceptTrainingPlanVersionRpcError(error.message);

  return parseAcceptTrainingPlanVersionResult(data);
}
