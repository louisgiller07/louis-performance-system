/**
 * UX-11A.5c.3 — the V2 daily write: exactly ONE call to the RPC
 * `persist_daily_run_v2` (migration 20261001120000), which writes the health
 * flag, the decision (caller-minted id), its durable final prescription
 * status and the optional final prescription atomically. The V1
 * `persist_daily_run` is never called on this path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionInsertRow } from "../mapping/dailyPlanToDecisionRow.js";
import type { HealthFlagPersistencePayload } from "../mapping/healthFlagToCreatePayload.js";
import type { FinalPrescriptionOutcomePayload } from "./finalPrescriptionOutcome.js";

export type FinalPrescriptionStatus = "created" | "not_required" | "blocked";

export interface PersistDailyRunV2Result {
  decision_id: string;
  health_flag_id: string | null;
  final_prescription_id: string | null;
  final_prescription_status: FinalPrescriptionStatus;
}

export class PersistDailyRunV2RpcError extends Error {
  constructor(message: string) {
    super(`persist_daily_run_v2 RPC call failed: ${message}`);
    this.name = "PersistDailyRunV2RpcError";
  }
}

export class InvalidPersistDailyRunV2ResultError extends Error {
  constructor(reason: string, value: unknown) {
    super(`persist_daily_run_v2 returned an invalid result: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidPersistDailyRunV2ResultError";
  }
}

export function parsePersistDailyRunV2Result(data: unknown): PersistDailyRunV2Result {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new InvalidPersistDailyRunV2ResultError("expected a JSON object", data);
  const obj = data as Record<string, unknown>;
  if (typeof obj.decision_id !== "string") throw new InvalidPersistDailyRunV2ResultError("decision_id is missing or not a string", data);
  if (obj.health_flag_id !== null && typeof obj.health_flag_id !== "string") throw new InvalidPersistDailyRunV2ResultError("health_flag_id is neither a string nor null", data);
  if (obj.final_prescription_id !== null && typeof obj.final_prescription_id !== "string") {
    throw new InvalidPersistDailyRunV2ResultError("final_prescription_id is neither a string nor null", data);
  }
  if (obj.final_prescription_status !== "created" && obj.final_prescription_status !== "not_required" && obj.final_prescription_status !== "blocked") {
    throw new InvalidPersistDailyRunV2ResultError("final_prescription_status is not a known status", data);
  }
  return {
    decision_id: obj.decision_id,
    health_flag_id: obj.health_flag_id as string | null,
    final_prescription_id: obj.final_prescription_id as string | null,
    final_prescription_status: obj.final_prescription_status,
  };
}

export async function persistDailyRunV2(
  client: SupabaseClient,
  athleteId: string,
  healthFlag: HealthFlagPersistencePayload | null,
  decisionRow: DecisionInsertRow & { id: string },
  outcome: FinalPrescriptionOutcomePayload
): Promise<PersistDailyRunV2Result> {
  const { data, error } = await client.rpc("persist_daily_run_v2", {
    p_athlete_id: athleteId,
    p_health_flag: healthFlag,
    p_decision_row: decisionRow,
    p_final_prescription_outcome: outcome,
  });
  if (error) throw new PersistDailyRunV2RpcError(error.message);
  return parsePersistDailyRunV2Result(data);
}
