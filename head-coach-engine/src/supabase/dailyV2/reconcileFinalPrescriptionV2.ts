/**
 * UX-11A.5c.3 — V2 daily reconciliation (integration layer, read-only).
 *
 * Runs AFTER M1: M1's DailyPlan is final and is never changed here. Today's
 * plan lineage comes only from the planned_sessions observation M1 consumed
 * (`PlannedSessionObservation`, same read) — never from a second
 * planned_sessions read. The generated session and its planned prescription
 * are read only in the CURRENT plan version captured by the discriminant;
 * never by date, never in another version, never a V1 fallback.
 *
 * The decision itself is made by the pure 5c.1 module
 * (`buildKeepFinalPrescriptionV2`): KEEP with real lineage → created (verbatim
 * copy); REST → none; no lineage → final_prescription_no_lineage; MODIFY /
 * REPLACE / KEEP hiding a difference → final_prescription_adaptation_not_defined;
 * older unreadable catalogue → final_prescription_catalog_mismatch. Corrupt
 * data raises a contract error.
 *
 * Loaded lazily by runDailyFor (V2 path only): this is the only daily module
 * with a runtime import of `planning-engine/session-model-v2`, so the V1
 * daily path's static import graph is unchanged (see runDailyFor).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildKeepFinalPrescriptionV2, type FinalPrescriptionV2, type FinalPrescriptionV2Result } from "planning-engine/session-model-v2";
import type { DailyPlan } from "../../types/index.js";
import type { PlannedSessionObservation } from "../buildRawContext.js";
import { getGeneratedSessionOfVersion } from "../repositories/trainingPlanGeneratedSessionsRepo.js";
import { getPlannedPrescriptionRowOfVersion } from "../repositories/trainingPlanPlannedPrescriptionsRepo.js";

export type { FinalPrescriptionV2, FinalPrescriptionV2Result };

export interface ReconcileFinalPrescriptionV2Input {
  client: SupabaseClient;
  /** The current plan version captured by the discriminant (the only version lineage may point to). */
  currentPlanVersionId: string;
  /** Minted by the integration layer after M1; also the persisted decision id. */
  decisionId: string;
  finalPrescriptionId: string;
  /** M1's DailyPlan (decision + final_session), read only. */
  dailyPlan: DailyPlan;
  /** The planned_sessions observation M1 consumed; null when today has no planned session. */
  observation: PlannedSessionObservation | null;
}

export interface ReconcileFinalPrescriptionV2Deps {
  getGeneratedSessionOfVersion: typeof getGeneratedSessionOfVersion;
  getPlannedPrescriptionRowOfVersion: typeof getPlannedPrescriptionRowOfVersion;
}

const DEFAULT_DEPS: ReconcileFinalPrescriptionV2Deps = { getGeneratedSessionOfVersion, getPlannedPrescriptionRowOfVersion };

export async function reconcileFinalPrescriptionV2(
  input: ReconcileFinalPrescriptionV2Input,
  deps: ReconcileFinalPrescriptionV2Deps = DEFAULT_DEPS
): Promise<FinalPrescriptionV2Result> {
  const { client, currentPlanVersionId, dailyPlan, observation } = input;
  const decision = dailyPlan.decision;

  // Plan rows are read only when the observation itself carries a real
  // lineage into the current version, and only for decisions that may use it.
  const lineageInCurrentVersion =
    observation !== null &&
    observation.source === "generated" &&
    observation.sourceGeneratedSessionId !== null &&
    observation.sourcePlanVersionId === currentPlanVersionId;
  const needsPlanRows = decision === "KEEP" || decision === "MODIFY";
  const generated =
    lineageInCurrentVersion && needsPlanRows ? await deps.getGeneratedSessionOfVersion(client, currentPlanVersionId, observation.sourceGeneratedSessionId!) : null;
  const planned = generated !== null ? await deps.getPlannedPrescriptionRowOfVersion(client, currentPlanVersionId, generated.id) : null;

  const final = dailyPlan.final_session;
  return buildKeepFinalPrescriptionV2({
    finalPrescriptionId: input.finalPrescriptionId,
    decision: {
      decisionId: input.decisionId,
      decision,
      finalSession: {
        kind: final.kind,
        ...(final.load_profile !== undefined ? { loadProfile: final.load_profile } : {}),
        ...(final.duration_min !== undefined ? { durationMin: final.duration_min } : {}),
      },
    },
    lineage:
      observation === null
        ? null
        : {
            plannedSessionSource: observation.source ?? "",
            sourcePlanVersionId: observation.sourcePlanVersionId,
            sourceGeneratedSessionId: observation.sourceGeneratedSessionId,
            currentPlanVersionId,
            generatedSession:
              generated === null
                ? null
                : {
                    id: generated.id,
                    kind: generated.kind,
                    loadProfile: generated.load_profile as "LIGHT" | "MODERATE" | "HEAVY" | null,
                    durationMin: generated.duration_min,
                  },
          },
    plannedPrescription:
      planned === null
        ? null
        : {
            id: planned.id,
            generatedPlanSessionId: planned.generated_plan_session_id,
            schemaVersion: planned.schema_version,
            catalogVersion: planned.catalog_version,
            structure: planned.structure,
          },
  });
}
