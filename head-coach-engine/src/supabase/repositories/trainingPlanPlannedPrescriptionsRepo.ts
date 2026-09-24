/**
 * Read-only access to `training_plan_planned_prescriptions`, by the exact
 * generated session it belongs to — never by date, never by "latest plan"
 * (V0.5_047/048 lock). See
 * supabase/migrations/20260921091500_v0_4_001d_training_plan_prescriptions.sql:
 * `UNIQUE(generated_plan_session_id)` guarantees at most one row per
 * session, so a lookup by that exact id can never be ambiguous.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlannedPrescription } from "planning-engine";
import { assertNoSupabaseError } from "./supabaseError.js";

interface PlannedPrescriptionRawRow {
  id: string;
  generated_plan_session_id: string;
  schema_version: string;
  catalog_version: string;
  structure: unknown;
}

const COLUMNS = "id, generated_plan_session_id, schema_version, catalog_version, structure";

function mapRow(row: PlannedPrescriptionRawRow): PlannedPrescription {
  return {
    id: row.id,
    generatedPlanSessionId: row.generated_plan_session_id,
    schemaVersion: row.schema_version,
    catalogVersion: row.catalog_version,
    // `structure` is a real `jsonb not null` column, written exactly once at
    // generation time by the append-only generation RPC (never hand-edited)
    // — trusted here the same way every other head-coach-engine repository
    // trusts its own DB rows without re-validating their shape (e.g.
    // trainingPlanGeneratedSessionsRepo.ts's own plain cast).
    structure: row.structure as PlannedPrescription["structure"],
  };
}

/**
 * Fetches the canonical prescription for exactly one generated session, or
 * `null` if none exists — a legitimate, expected state for an aerobic
 * session (planning-engine's PRESCRIBABLE_DOMAINS never generates a
 * prescription for that domain), never treated as an error.
 */
export async function getPlannedPrescriptionForGeneratedSession(
  client: SupabaseClient,
  generatedPlanSessionId: string
): Promise<PlannedPrescription | null> {
  const { data, error } = await client
    .from("training_plan_planned_prescriptions")
    .select(COLUMNS)
    .eq("generated_plan_session_id", generatedPlanSessionId)
    .maybeSingle();

  assertNoSupabaseError(error, "training_plan_planned_prescriptions");
  return data ? mapRow(data as PlannedPrescriptionRawRow) : null;
}
