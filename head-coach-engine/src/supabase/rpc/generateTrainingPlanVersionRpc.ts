/**
 * Typed wrapper around the `generate_training_plan_version` RPC
 * (supabase/migrations/20260921092000_v0_4_001e_generate_training_plan_
 * version_rpc.sql, unmodified). Same style as acceptTrainingPlanVersionRpc.ts/
 * abandonTrainingPlanVersionRpc.ts/projectTrainingPlanRpc.ts/persistDailyRun.ts
 * — one RPC call, an explicit runtime parser that never blind-casts the
 * returned JSON, custom error classes.
 *
 * Parameter names (p_athlete_id, p_generation_request_id, p_version,
 * p_blocks, p_weeks, p_sessions, p_planned_prescriptions) and the return
 * shape (`plan_version_id`, `idempotent_replay` — snake_case, confirmed by
 * two `jsonb_build_object` return statements in the SQL) were verified by
 * reading that migration directly, not assumed. No third field, unlike its
 * accept/abandon siblings which also carry an optional transition id.
 *
 * This file does nothing but pass GenerateTrainingPlanVersionPayload's
 * fields through to the p_* parameters and parse the response — no id
 * minting, no business/coaching transformation, no computed value. Every
 * value in the payload was already produced upstream by generationEngine.ts
 * and generationResultToPersistencePayload.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerateTrainingPlanVersionPayload } from "../mapping/generationResultToPersistencePayload.js";

export interface GenerateTrainingPlanVersionResult {
  planVersionId: string;
  idempotentReplay: boolean;
}

export class GenerateTrainingPlanVersionRpcError extends Error {
  constructor(message: string) {
    super(`generate_training_plan_version RPC call failed: ${message}`);
    this.name = "GenerateTrainingPlanVersionRpcError";
  }
}

export class InvalidGenerateTrainingPlanVersionResultError extends Error {
  constructor(reason: string, value: unknown) {
    super(`generate_training_plan_version returned an invalid result: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidGenerateTrainingPlanVersionResultError";
  }
}

/**
 * Validates the RPC's raw JSON result at runtime. Never casts blindly: a
 * missing/non-string `plan_version_id` or a missing/non-boolean
 * `idempotent_replay` are both rejected explicitly.
 */
export function parseGenerateTrainingPlanVersionResult(data: unknown): GenerateTrainingPlanVersionResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidGenerateTrainingPlanVersionResultError("expected a JSON object", data);
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.plan_version_id !== "string") {
    throw new InvalidGenerateTrainingPlanVersionResultError("plan_version_id is missing or not a string", data);
  }
  if (typeof obj.idempotent_replay !== "boolean") {
    throw new InvalidGenerateTrainingPlanVersionResultError("idempotent_replay is missing or not a boolean", data);
  }

  return {
    planVersionId: obj.plan_version_id,
    idempotentReplay: obj.idempotent_replay,
  };
}

/** Invokes `generate_training_plan_version` exactly once with the given payload. */
export async function generateTrainingPlanVersionRpc(
  client: SupabaseClient,
  payload: GenerateTrainingPlanVersionPayload
): Promise<GenerateTrainingPlanVersionResult> {
  const { data, error } = await client.rpc("generate_training_plan_version", {
    p_athlete_id: payload.athleteId,
    p_generation_request_id: payload.generationRequestId,
    p_version: payload.version,
    p_blocks: payload.blocks,
    p_weeks: payload.weeks,
    p_sessions: payload.sessions,
    p_planned_prescriptions: payload.plannedPrescriptions,
  });

  if (error) throw new GenerateTrainingPlanVersionRpcError(error.message);

  return parseGenerateTrainingPlanVersionResult(data);
}
