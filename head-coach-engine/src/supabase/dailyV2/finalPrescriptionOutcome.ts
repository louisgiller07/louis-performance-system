/**
 * UX-11A.5c.3 — pure mapping of the V2 reconciliation result to the
 * `p_final_prescription_outcome` payload of persist_daily_run_v2 (no rule,
 * no id minted). Type-only dependency on the Session Model V2 module, so it
 * can sit in runDailyFor's static import graph.
 */
import type { FinalPrescriptionV2Result } from "planning-engine/session-model-v2";

/** persist_daily_run_v2's `p_final_prescription_outcome` (exactly one object, never a collection). */
export type FinalPrescriptionOutcomePayload =
  | { status: "created"; final_prescription: Record<string, unknown> }
  | { status: "not_required" }
  | { status: "blocked"; code: string; detail?: Readonly<Record<string, unknown>> };

/** Pure transformation of the reconciliation result into the RPC payload (no rule, no id minted). */
export function toFinalPrescriptionOutcome(result: FinalPrescriptionV2Result, athleteId: string): FinalPrescriptionOutcomePayload {
  if (result.status === "none") return { status: "not_required" };
  if (result.status === "blocked") {
    return { status: "blocked", code: result.code, ...(Object.keys(result.detail).length > 0 ? { detail: result.detail } : {}) };
  }
  const fp = result.finalPrescription;
  return {
    status: "created",
    final_prescription: {
      id: fp.id,
      decision_id: fp.decisionId,
      athlete_id: athleteId,
      plan_version_id: fp.planVersionId ?? null,
      planned_prescription_id: fp.plannedPrescriptionId ?? null,
      active_session_origin: fp.activeSessionOrigin,
      reconciliation_action: fp.reconciliationAction,
      adaptation_rule_ids: fp.adaptationRuleIds,
      schema_version: fp.schemaVersion,
      catalog_version: fp.catalogVersion,
      structure: fp.structure,
    },
  };
}
