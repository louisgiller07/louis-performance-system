/**
 * M1 `HealthFlagToCreate` → `persist_daily_run`'s `p_health_flag` JSONB
 * payload. See docs/05_DATA_MODEL.md §health_flags,
 * docs/06_ARCHITECTURE.md §Persistance idempotente + atomique, and
 * `supabase/migrations/20260816213500_M2_006_persist_daily_run.sql`
 * (required payload fields: `flag_type`, `flag_date`, `description`).
 *
 * Canonical mapping, nothing else:
 *   HealthFlagToCreate.type   → flag_type
 *   HealthFlagToCreate.reason → description
 *   date of the run           → flag_date
 *
 * `status` is deliberately never included: `health_flags.status` already
 * has `DEFAULT 'active'` in the DB schema, and the RPC never sets it
 * explicitly either — this mapper does not invent a "new flags are
 * active" rule, it just doesn't touch a column with a real DB default
 * (same treatment as `overridden_by_user` in dailyPlanToDecisionRow.ts).
 * `body_location`, `intensity`, `professional_consulted` are not part of
 * M1's `HealthFlagToCreate` and are not fabricated here either —
 * `source_checkin_id` is intentionally omitted too (see runDailyFor.ts
 * module doc: the current read path does not expose a checkin row id).
 */
import type { HealthFlagToCreate } from "../../types/index.js";

export interface HealthFlagPersistencePayload {
  flag_type: HealthFlagToCreate["type"];
  flag_date: string;
  description: string;
}

/**
 * Maps a M1 `HealthFlagToCreate` (from `DailyPlan.health_flag_to_create`)
 * plus the run's date to the RPC's `p_health_flag` payload shape. Pure
 * translation, no coaching logic, no additional field invented.
 */
export function mapHealthFlagToCreatePayload(
  healthFlag: HealthFlagToCreate,
  date: string
): HealthFlagPersistencePayload {
  return {
    flag_type: healthFlag.type,
    flag_date: date,
    description: healthFlag.reason,
  };
}
