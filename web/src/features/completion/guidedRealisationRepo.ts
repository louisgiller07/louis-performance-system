// PARTIAL-01 (HPM 2026-10-18) — the realisation of COMPLETED guided executions, from what is persisted: each
// execution's own frozen final prescription (decision_final_prescriptions, strict V2 decoder) and its set results
// (exercise_set_results, corrections applied by guidedRealisationOf). RLS reads grouped by chunks of executions, no
// N+1; set results are paged and checked against an exact count, so a server row cap never turns into missing sets.
// Best effort: a read that fails, an incomplete read or a prescription that no longer decodes leaves the execution
// without a realisation (shown neutrally, never as fully done) — it never fails the screen that asked.
import { supabase } from "../../lib/supabase";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import { SET_RESULT_COLUMNS, toSetResultRow } from "../guidedSession/executionRepo";
import type { SetResultRow } from "../guidedSession/executionState";
import { guidedRealisationOf, type SessionRealisation } from "./guidedRealisation";

export interface CompletedExecutionRef {
  executionId: string;
  finalPrescriptionId: string | null;
}

/** Executions per read (keeps the `in` filters short). */
const CHUNK = 50;
/** Set results per page; the server may cap a page lower, the exact count decides when the read is complete. */
const PAGE = 1000;

type LinkedRef = CompletedExecutionRef & { finalPrescriptionId: string };
type SetRow = SetResultRow & { execution_id: string };
type PrescriptionRow = { id: unknown; decision_id: unknown; schema_version: unknown; catalog_version: unknown; structure: unknown };

/** Every set result of `executionIds`, or null when the read failed or came back incomplete. */
async function readSetResults(athleteId: string, executionIds: readonly string[]): Promise<SetRow[] | null> {
  const rows: SetRow[] = [];
  for (;;) {
    const { data, error, count } = await supabase
      .from("exercise_set_results")
      .select(`execution_id, ${SET_RESULT_COLUMNS}`, { count: "exact" })
      .eq("athlete_id", athleteId)
      .in("execution_id", [...executionIds])
      .order("id", { ascending: true })
      .range(rows.length, rows.length + PAGE - 1);
    if (error || typeof count !== "number") return null;
    const page = (data ?? []) as SetRow[];
    rows.push(...page);
    if (rows.length >= count || page.length === 0) return rows.length === count ? rows : null;
  }
}

async function readChunk(athleteId: string, chunk: readonly LinkedRef[], into: Map<string, SessionRealisation>): Promise<void> {
  const [prescriptions, sets] = await Promise.all([
    supabase
      .from("decision_final_prescriptions")
      .select("id, decision_id, schema_version, catalog_version, structure")
      .in("id", [...new Set(chunk.map((e) => e.finalPrescriptionId))]),
    readSetResults(
      athleteId,
      chunk.map((e) => e.executionId)
    ),
  ]);
  if (prescriptions.error || sets === null) {
    console.error("guidedRealisationRepo.loadGuidedRealisations: read failed or incomplete", prescriptions.error?.code ?? "sets");
    return;
  }
  const views = new Map<string, FinalPrescriptionV2View>();
  for (const row of (prescriptions.data ?? []) as PrescriptionRow[]) {
    const decoded = decodeFinalPrescriptionV2({ id: row.id, decisionId: row.decision_id, schemaVersion: row.schema_version, catalogVersion: row.catalog_version, structure: row.structure });
    if (decoded.ok) views.set(String(row.id), decoded.view);
  }
  const setsByExecution = new Map<string, SetResultRow[]>();
  for (const row of sets) setsByExecution.set(row.execution_id, [...(setsByExecution.get(row.execution_id) ?? []), toSetResultRow(row)]);
  for (const execution of chunk) {
    const view = views.get(execution.finalPrescriptionId);
    const realisation = view ? guidedRealisationOf(view, setsByExecution.get(execution.executionId) ?? []) : null;
    if (realisation) into.set(execution.executionId, realisation);
  }
}

/** executionId → realisation, for the executions whose prescription and results could be read in full. */
export async function loadGuidedRealisations(athleteId: string, executions: readonly CompletedExecutionRef[]): Promise<Map<string, SessionRealisation>> {
  const realisations = new Map<string, SessionRealisation>();
  const linked = executions.filter((e): e is LinkedRef => e.finalPrescriptionId !== null);
  const chunks = Array.from({ length: Math.ceil(linked.length / CHUNK) }, (_, i) => linked.slice(i * CHUNK, (i + 1) * CHUNK));
  try {
    await Promise.all(chunks.map((chunk) => readChunk(athleteId, chunk, realisations)));
  } catch {
    console.error("guidedRealisationRepo.loadGuidedRealisations failed");
  }
  return realisations;
}
