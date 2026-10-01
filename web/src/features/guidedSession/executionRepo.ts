// UX-11C.1 — minimal readers for the guided session (RLS: the rider reads
// only their own rows). No write here: every write goes through the
// session-execution Edge Function.
import { supabase } from "../../lib/supabase";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { ExecutionRow } from "./executionState";
import { activeResultsBySlot } from "./results/activeResults";

export class GuidedSessionLoadError extends Error {
  constructor() {
    super("Impossible de charger ta séance. Réessaie.");
    this.name = "GuidedSessionLoadError";
  }
}

const SET_RESULT_COLUMNS = "id, prescription_item_id, other_exercise_name, set_number, done, measure_type, measure_value, load_kg, rpe_actual, success, supersedes_id, occurred_at, recorded_at";

// numeric columns may come back as strings depending on the PostgREST setting: always numbers here.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The rider's executions of `date` with their lifecycle events and set results (one query, no N+1). */
export async function loadDayExecutions(athleteId: string, date: string): Promise<ExecutionRow[]> {
  const { data, error } = await supabase
    .from("session_executions")
    .select(`id, session_date, final_prescription_id, started_at, recorded_at, execution_events(event_type, event_seq), exercise_set_results(${SET_RESULT_COLUMNS})`)
    .eq("athlete_id", athleteId)
    .eq("session_date", date)
    .order("recorded_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("executionRepo.loadDayExecutions failed", error.code);
    throw new GuidedSessionLoadError();
  }
  const executions = ((data ?? []) as ExecutionRow[]).map((e) => ({
    ...e,
    exercise_set_results: (e.exercise_set_results ?? []).map((r) => ({ ...r, measure_value: num(r.measure_value), load_kg: num(r.load_kg), rpe_actual: num(r.rpe_actual) })),
  }));
  // UX-11B.2.6 — at most one active result per slot: anything else is never arbitrated (fail closed).
  try {
    for (const e of executions) activeResultsBySlot(e.exercise_set_results);
  } catch {
    console.error("executionRepo.loadDayExecutions: ambiguous active results");
    throw new GuidedSessionLoadError();
  }
  return executions;
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
