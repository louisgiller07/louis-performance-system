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
import type { PrescriptionRead } from "../prescriptionRead.js";

/**
 * UX-11A.5b.1 — what this reader can interpret: v1 only. Any other
 * `schema_version` (v2, or an unknown value) comes back as
 * "unsupported_by_reader" and its structure is never cast into the v1 type.
 */
export type PlannedPrescriptionRead = PrescriptionRead<PlannedPrescription, never>;

export interface PlannedPrescriptionRawRow {
  id: string;
  generated_plan_session_id: string;
  schema_version: string;
  catalog_version: string;
  structure: unknown;
}

const COLUMNS = "id, generated_plan_session_id, schema_version, catalog_version, structure";

function mapRow(row: PlannedPrescriptionRawRow): PlannedPrescriptionRead {
  if (row.schema_version !== "v1") {
    return { status: "unsupported_by_reader", schemaVersion: row.schema_version, prescriptionId: row.id };
  }
  const prescription: PlannedPrescription = {
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
  return { status: "supported", schemaVersion: "v1", prescription };
}

/**
 * Fetches the canonical prescription for exactly one generated session, or
 * `null` if none exists — a legitimate, expected state for an aerobic
 * session (planning-engine's PRESCRIBABLE_DOMAINS never generates a
 * prescription for that domain), never treated as an error. A row the
 * reader does not implement is returned as "unsupported_by_reader", never
 * dropped.
 */
/**
 * UX-11A.5c.3 — the raw stored row (no reader guard, no interpretation) of
 * the planned prescription of one generated session of exactly
 * `planVersionId`, for the V2 daily reconciliation, which validates it
 * itself. Never a lookup by date, never in another version.
 */
export async function getPlannedPrescriptionRowOfVersion(
  client: SupabaseClient,
  planVersionId: string,
  generatedPlanSessionId: string
): Promise<PlannedPrescriptionRawRow | null> {
  const { data, error } = await client
    .from("training_plan_planned_prescriptions")
    .select(COLUMNS)
    .eq("plan_version_id", planVersionId)
    .eq("generated_plan_session_id", generatedPlanSessionId)
    .maybeSingle();
  assertNoSupabaseError(error, "training_plan_planned_prescriptions");
  return (data as PlannedPrescriptionRawRow | null) ?? null;
}

export async function getPlannedPrescriptionForGeneratedSession(
  client: SupabaseClient,
  generatedPlanSessionId: string
): Promise<PlannedPrescriptionRead | null> {
  const { data, error } = await client
    .from("training_plan_planned_prescriptions")
    .select(COLUMNS)
    .eq("generated_plan_session_id", generatedPlanSessionId)
    .maybeSingle();

  assertNoSupabaseError(error, "training_plan_planned_prescriptions");
  return data ? mapRow(data as PlannedPrescriptionRawRow) : null;
}
