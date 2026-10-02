// UX-11C.2 / 11C.3 — the active result of each prescribed slot (a Force set
// or a DH pass ordinal): the row that no other row supersedes. Since
// UX-11B.2.6 the database holds at most ONE original per (execution, item,
// ordinal) and at most one correction per original, so each slot has at
// most one active row: the reader never arbitrates between rows (no "most
// recent wins"). Anything else is an inconsistency: fail closed.
import type { ActivityResultRow, SetResultRow } from "../executionState";

export class AmbiguousResultsError extends Error {
  constructor(slot: string) {
    super(`several active results for slot ${slot}`);
    this.name = "AmbiguousResultsError";
  }
}

export const slotKey = (prescriptionItemId: string, ordinal: number) => `${prescriptionItemId.toLowerCase()}#${ordinal}`;

export function activeResultsBySlot(rows: readonly SetResultRow[]): Map<string, SetResultRow> {
  const superseded = new Set(rows.filter((r) => r.supersedes_id).map((r) => r.supersedes_id!.toLowerCase()));
  const bySlot = new Map<string, SetResultRow>();
  for (const row of rows) {
    if (superseded.has(row.id.toLowerCase()) || row.prescription_item_id === null) continue;
    const key = slotKey(row.prescription_item_id, row.set_number);
    if (bySlot.has(key)) throw new AmbiguousResultsError(key);
    bySlot.set(key, row);
  }
  return bySlot;
}

/** A correction is itself never corrected (backend rule): only an original can be. */
export const isCorrectable = (row: { supersedes_id: string | null }) => row.supersedes_id === null;

/**
 * An entry being typed stays open only while the slot is still as it was
 * when the entry opened: its own id is not recorded yet, a new entry's slot
 * is still empty, a correction's original is still uncorrected (another tab
 * may have written meanwhile: the confirmed state wins, never a second active row).
 */
export function entryStillOpen(entry: { id: string; prescriptionItemId: string; ordinal: number; supersedesId: string | null }, rows: readonly SetResultRow[]): boolean {
  if (rows.some((r) => r.id.toLowerCase() === entry.id.toLowerCase())) return false;
  if (entry.supersedesId !== null) return !rows.some((r) => r.supersedes_id?.toLowerCase() === entry.supersedesId!.toLowerCase());
  return !activeResultsBySlot(rows).has(slotKey(entry.prescriptionItemId, entry.ordinal));
}

/**
 * UX-11C.4 — the active activity result of an execution: the row nobody
 * supersedes. The backend holds at most one original per execution
 * (activity_result_exists) and one correction per original, so there is at
 * most one; anything else fails closed (never "the latest wins").
 */
export function activeActivityResult(rows: readonly ActivityResultRow[]): ActivityResultRow | null {
  const superseded = new Set(rows.filter((r) => r.supersedes_id).map((r) => r.supersedes_id!.toLowerCase()));
  const active = rows.filter((r) => !superseded.has(r.id.toLowerCase()));
  if (active.length > 1) throw new AmbiguousResultsError("activity");
  return active[0] ?? null;
}
