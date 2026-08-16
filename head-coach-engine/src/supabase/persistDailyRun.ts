/**
 * Typed wrapper around the `persist_daily_run` RPC (M2_006). See
 * `supabase/migrations/20260816213500_M2_006_persist_daily_run.sql` and
 * docs/06_ARCHITECTURE.md §Persistance idempotente + atomique.
 *
 * Exactly one RPC call — the two writes (health flag + decision) are
 * atomic on the PostgreSQL side (M2_006); this wrapper does not and must
 * not split them into separate client-side calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionInsertRow } from "./mapping/dailyPlanToDecisionRow.js";
import type { HealthFlagPersistencePayload } from "./mapping/healthFlagToCreatePayload.js";

export interface PersistDailyRunResult {
  decision_id: string;
  health_flag_id: string | null;
}

export class PersistDailyRunRpcError extends Error {
  constructor(message: string) {
    super(`persist_daily_run RPC call failed: ${message}`);
    this.name = "PersistDailyRunRpcError";
  }
}

export class InvalidPersistDailyRunResultError extends Error {
  constructor(reason: string, value: unknown) {
    super(`persist_daily_run returned an invalid result: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidPersistDailyRunResultError";
  }
}

/**
 * Validates the RPC's raw JSON result at runtime. Never casts blindly:
 * `data = null`, a missing/non-string `decision_id`, or a `health_flag_id`
 * that is neither a string nor `null` are all rejected explicitly.
 */
export function parsePersistDailyRunResult(data: unknown): PersistDailyRunResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidPersistDailyRunResultError("expected a JSON object", data);
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.decision_id !== "string") {
    throw new InvalidPersistDailyRunResultError("decision_id is missing or not a string", data);
  }
  if (obj.health_flag_id !== null && typeof obj.health_flag_id !== "string") {
    throw new InvalidPersistDailyRunResultError("health_flag_id is neither a string nor null", data);
  }

  return { decision_id: obj.decision_id, health_flag_id: obj.health_flag_id as string | null };
}

/**
 * Invokes `persist_daily_run` exactly once with the three RPC parameters.
 * Propagates a Supabase client error explicitly ({@link PersistDailyRunRpcError})
 * rather than returning a partial/undefined result, and validates the
 * returned JSON via {@link parsePersistDailyRunResult} before returning it.
 */
export async function persistDailyRun(
  client: SupabaseClient,
  athleteId: string,
  healthFlag: HealthFlagPersistencePayload | null,
  decisionRow: DecisionInsertRow
): Promise<PersistDailyRunResult> {
  const { data, error } = await client.rpc("persist_daily_run", {
    p_athlete_id: athleteId,
    p_health_flag: healthFlag,
    p_decision_row: decisionRow,
  });

  if (error) throw new PersistDailyRunRpcError(error.message);

  return parsePersistDailyRunResult(data);
}
