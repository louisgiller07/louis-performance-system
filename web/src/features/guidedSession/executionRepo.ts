// UX-11C.1 — minimal readers for the guided session (RLS: the rider reads
// only their own rows). No write here: every write goes through the
// session-execution Edge Function.
import { supabase } from "../../lib/supabase";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { ExecutionRow } from "./executionState";

export class GuidedSessionLoadError extends Error {
  constructor() {
    super("Impossible de charger ta séance. Réessaie.");
    this.name = "GuidedSessionLoadError";
  }
}

/** The rider's executions of `date` with their lifecycle events (one query). */
export async function loadDayExecutions(athleteId: string, date: string): Promise<ExecutionRow[]> {
  const { data, error } = await supabase
    .from("session_executions")
    .select("id, session_date, final_prescription_id, started_at, recorded_at, execution_events(event_type, event_seq)")
    .eq("athlete_id", athleteId)
    .eq("session_date", date)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("executionRepo.loadDayExecutions failed", error.code);
    throw new GuidedSessionLoadError();
  }
  return (data ?? []) as ExecutionRow[];
}

/**
 * The final prescription an EXISTING execution is linked to — frozen for that
 * execution: never replaced by a newer daily decision. Decoded with the
 * strict 5c.4 decoder (supported catalogue only, no partial rendering).
 */
export async function loadExecutionPrescription(finalPrescriptionId: string): Promise<FinalPrescriptionV2State> {
  const { data, error } = await supabase
    .from("decision_final_prescriptions")
    .select("id, decision_id, schema_version, catalog_version, structure")
    .eq("id", finalPrescriptionId)
    .maybeSingle();
  if (error) {
    console.error("executionRepo.loadExecutionPrescription failed", error.code);
    throw new GuidedSessionLoadError();
  }
  if (!data) return { kind: "final_prescription_missing" };
  const row = data as { id: unknown; decision_id: unknown; schema_version: unknown; catalog_version: unknown; structure: unknown };
  const decoded = decodeFinalPrescriptionV2({ id: row.id, decisionId: row.decision_id, schemaVersion: row.schema_version, catalogVersion: row.catalog_version, structure: row.structure });
  return decoded.ok ? { kind: "created", prescription: decoded.view } : { kind: decoded.kind, reason: decoded.reason };
}
