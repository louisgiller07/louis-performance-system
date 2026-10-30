// V2-DH-SPORT-GATE-01C (HPM 2026-10-26) — same-day revocation guard of a DH sports validation.
//
// A DH count is prescribed only under a current sports validation (planning-engine dhSportGateV2). The validation
// lives in the engine code, which record_session_execution (SQL) cannot read: without this guard, a final prescription
// frozen while its validation was current stays executable for the rest of its day once the validation is revoked.
//
// Before the RPC, the guard refuses every training action on such a document with `dh_validation_not_current`:
// a new execution, a `resumed` or `completed` event, a set or activity result (corrections included). Allowed, as
// under the P0-3 health guard: `paused`, `abandoned` (safe closure, recorded results kept), an id already recorded
// (a replay, left to the RPC), reading.
//
// Not bypassable by a client: record_session_execution is granted to service_role only, and this function is its only
// caller. Not transactional with the RPC, and it need not be: the documents read are immutable (no-update triggers),
// and a validation changes only with a deploy of the engine code — the code this very request runs. Residual: requests
// still running on the previous deploy, a function deployed from another build, the service_role key itself.
// Deno-free (unit-tested under Node): the reader and the engine check are injected.
import type { SessionExecutionBatch } from "./validation.ts";

export const DH_VALIDATION_NOT_CURRENT = "dh_validation_not_current";
/**
 * Its HTTP status. V2-DH-REVOCATION — record_session_execution also returns this code for a drill revoked in the
 * database (migration 20261027120000): REJECTION_STATUS maps it to the same status (pinned by test).
 */
export const DH_VALIDATION_NOT_CURRENT_STATUS = 409;

export type ExecutionTable = "session_executions" | "execution_events" | "exercise_set_results" | "session_activity_results";

export interface DhValidationGuardReader {
  /** The ids among `ids` already recorded in `table` (the rider's own rows). */
  recorded(table: ExecutionTable, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Execution id → its final prescription id (the rider's own executions). */
  executionPrescriptions(executionIds: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  /** Final prescription id → its stored structure (the rider's own prescriptions). */
  structures(prescriptionIds: readonly string[]): Promise<ReadonlyMap<string, unknown>>;
}

/** The engine's check (dhSportValidationCurrentV2), loaded only when a document states a DH unit. */
export type DhValidationCheckLoader = () => Promise<(structure: unknown) => boolean>;

const TRAINING_EVENTS: ReadonlySet<string> = new Set(["resumed", "completed"]);

/** A stored document with a DH drill stating a unit: the only documents that depend on a sports validation. */
export function statesDhUnit(structure: unknown): boolean {
  const blocks = (structure as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    const items = (block as { items?: unknown } | null)?.items;
    return Array.isArray(items) && items.some((item) => {
      const i = item as { kind?: unknown; measure?: { unit?: unknown } } | null;
      return i?.kind === "drill" && i.measure !== null && typeof i.measure === "object" && i.measure.unit !== undefined;
    });
  });
}

const notYet = async (reader: DhValidationGuardReader, table: ExecutionTable, ids: string[]) => {
  if (ids.length === 0) return new Set<string>();
  const recorded = await reader.recorded(table, ids);
  return new Set(ids.filter((id) => !recorded.has(id)));
};

/** True when the batch must be refused: a training action on a document whose DH sports validation is no longer current. */
export async function dhValidationRefusal(batch: SessionExecutionBatch, reader: DhValidationGuardReader, loadCheck: DhValidationCheckLoader): Promise<boolean> {
  const newExecution = batch.execution !== null && (await notYet(reader, "session_executions", [batch.execution.id])).size === 1 ? batch.execution : null;
  const [events, sets, activities] = await Promise.all([
    notYet(reader, "execution_events", batch.events.filter((e) => TRAINING_EVENTS.has(e.event_type)).map((e) => e.id)),
    notYet(reader, "exercise_set_results", batch.sets.map((s) => s.id)),
    notYet(reader, "session_activity_results", batch.activities.map((a) => a.id)),
  ]);
  const executions = new Set([
    ...batch.events.filter((e) => events.has(e.id)).map((e) => e.execution_id),
    ...batch.sets.filter((s) => sets.has(s.id)).map((s) => s.execution_id),
    ...batch.activities.filter((a) => activities.has(a.id)).map((a) => a.execution_id),
  ]);
  const prescriptions = new Set<string>();
  if (newExecution?.final_prescription_id) prescriptions.add(newExecution.final_prescription_id);
  // An execution created by this batch: its prescription is the one it names.
  if (batch.execution !== null && executions.delete(batch.execution.id) && batch.execution.final_prescription_id) prescriptions.add(batch.execution.final_prescription_id);
  if (executions.size > 0) {
    for (const prescription of (await reader.executionPrescriptions([...executions])).values()) if (prescription) prescriptions.add(prescription);
  }
  if (prescriptions.size === 0) return false;
  const stating = [...(await reader.structures([...prescriptions])).values()].filter(statesDhUnit);
  if (stating.length === 0) return false;
  const current = await loadCheck();
  return stating.some((structure) => !current(structure));
}
