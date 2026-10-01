// UX-11A.5c.4 — the two sources of a V2 daily final prescription state:
// - live: the daily-run response of the run that just happened;
// - restore: the persisted decision (status / code / detail) and, only when
//   the status is `created`, its single decision_final_prescriptions row.
// After persistence the final row is the authority: the state is never
// rebuilt from the planned prescription, the DailyPlan or planned_sessions.
import { supabase } from "../../lib/supabase";
import { decodeFinalPrescriptionV2, type FinalPrescriptionV2Record } from "./decodeFinalPrescriptionV2";
import type { FinalPrescriptionV2State } from "./finalPrescriptionV2Types";

export class FinalPrescriptionV2LoadError extends Error {
  constructor() {
    super("Impossible de charger le détail de ta séance. Réessaie.");
    this.name = "FinalPrescriptionV2LoadError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Status + optional code / detail → state, for every status but `created` (whose document is decoded separately). */
function nonCreatedState(status: unknown, code: unknown, detail: unknown): FinalPrescriptionV2State {
  if (status === "not_required") return { kind: "not_required" };
  if (status === "blocked" && typeof code === "string" && code.length > 0) return { kind: "blocked", code, detail: isObject(detail) ? detail : null };
  return { kind: "invalid", reason: `unknown final prescription status ${String(status)}` };
}

function createdState(record: FinalPrescriptionV2Record, decisionId: string): FinalPrescriptionV2State {
  if (record.decisionId !== decisionId) return { kind: "invalid", reason: "final prescription of another decision" };
  const decoded = decodeFinalPrescriptionV2(record);
  return decoded.ok ? { kind: "created", prescription: decoded.view } : { kind: decoded.kind, reason: decoded.reason };
}

/** Live daily-run response (V2 path only: undefined when the response carries no V2 status, i.e. the V1 path). */
export function finalPrescriptionV2StateFromResponse(response: {
  decisionId: string;
  finalPrescriptionStatus?: unknown;
  finalPrescriptionStatusCode?: unknown;
  finalPrescriptionStatusDetail?: unknown;
  finalPrescription?: unknown;
}): FinalPrescriptionV2State | undefined {
  if (response.finalPrescriptionStatus === undefined) return undefined;
  if (response.finalPrescriptionStatus !== "created") return nonCreatedState(response.finalPrescriptionStatus, response.finalPrescriptionStatusCode, response.finalPrescriptionStatusDetail);
  const fp = response.finalPrescription;
  if (!isObject(fp)) return { kind: "final_prescription_missing" };
  return createdState({ id: fp.id, decisionId: fp.decisionId, schemaVersion: fp.schemaVersion, catalogVersion: fp.catalogVersion, structure: fp.structure }, response.decisionId);
}

/** A restored decision as read by historyRepo (V2 fields absent → V1 / historical decision → undefined). */
export interface RestoredDecisionV2Fields {
  id: string;
  finalPrescriptionStatus?: string;
  finalPrescriptionStatusCode?: string;
  finalPrescriptionStatusDetail?: unknown;
  isLatestOfDay?: boolean;
}

export async function loadFinalPrescriptionV2State(decision: RestoredDecisionV2Fields): Promise<FinalPrescriptionV2State | undefined> {
  if (decision.finalPrescriptionStatus === undefined) return undefined;
  if (decision.isLatestOfDay !== true) return { kind: "invalid", reason: "not the day's latest decision" };
  if (decision.finalPrescriptionStatus !== "created") {
    return nonCreatedState(decision.finalPrescriptionStatus, decision.finalPrescriptionStatusCode, decision.finalPrescriptionStatusDetail);
  }
  const { data, error } = await supabase
    .from("decision_final_prescriptions")
    .select("id, decision_id, schema_version, catalog_version, structure")
    .eq("decision_id", decision.id);
  if (error) {
    console.error("finalPrescriptionV2State.load failed", error.code);
    throw new FinalPrescriptionV2LoadError();
  }
  const rows = (data ?? []) as Array<{ id: unknown; decision_id: unknown; schema_version: unknown; catalog_version: unknown; structure: unknown }>;
  if (rows.length === 0) return { kind: "final_prescription_missing" };
  if (rows.length > 1) return { kind: "invalid", reason: "several final prescriptions for one decision" };
  const row = rows[0]!;
  return createdState({ id: row.id, decisionId: row.decision_id, schemaVersion: row.schema_version, catalogVersion: row.catalog_version, structure: row.structure }, decision.id);
}
