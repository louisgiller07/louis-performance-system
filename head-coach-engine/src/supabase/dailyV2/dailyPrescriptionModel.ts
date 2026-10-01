/**
 * UX-11A.5c.3 — the daily V1 / V2 discriminant.
 *
 * The daily path is chosen ONLY by the `prescription_schema_version` of the
 * athlete's current accepted plan version (ADR UX-11A.5c.2 / 5c.3):
 * - no current version → historical V1 path;
 * - "v1" → historical V1 path;
 * - "v2" → V2 daily path (even on a day without planned session);
 * - anything else → fail-closed, before anything is computed or written.
 * Never inferred from the profile, the DH tier, today's lineage, a planned
 * session or the available catalogue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentPlanPrescriptionSchema } from "../repositories/trainingPlanCurrentVersionRepo.js";

export type DailyPrescriptionModel = { model: "v1"; planVersionId: string | null } | { model: "v2"; planVersionId: string };

export class UnsupportedPlanPrescriptionSchemaError extends Error {
  readonly code = "unsupported_plan_prescription_schema";
  readonly planVersionId: string;
  readonly schemaVersion: string;
  constructor(planVersionId: string, schemaVersion: string) {
    super(`The current plan version ${planVersionId} has prescription_schema_version "${schemaVersion}", which the daily run does not support.`);
    this.name = "UnsupportedPlanPrescriptionSchemaError";
    this.planVersionId = planVersionId;
    this.schemaVersion = schemaVersion;
  }
}

export async function resolveDailyPrescriptionModel(
  client: SupabaseClient,
  athleteId: string,
  read: typeof getCurrentPlanPrescriptionSchema = getCurrentPlanPrescriptionSchema
): Promise<DailyPrescriptionModel> {
  const current = await read(client, athleteId);
  if (current === null) return { model: "v1", planVersionId: null };
  if (current.prescription_schema_version === "v1") return { model: "v1", planVersionId: current.plan_version_id };
  if (current.prescription_schema_version === "v2") return { model: "v2", planVersionId: current.plan_version_id };
  throw new UnsupportedPlanPrescriptionSchemaError(current.plan_version_id, current.prescription_schema_version);
}
