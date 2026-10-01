// UX-11C.3 — pure model of a guided DH technical session: the ONE main drill
// of the execution's own final prescription takes one result per pass
// actually ridden (ordinal 1..measure.count, stored in set_number). Brief,
// warm-up, application and cool-down stay instructions. A planned pass
// without a row has no result (never failed, skipped or done); `success` is
// an optional observation of the drill's criterion, never a completion rule.
import type { DrillItemView, FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { SetResultRow } from "../executionState";
import { activeResultsBySlot, slotKey } from "../results/activeResults";

export function isGuidedDhPrescription(p: FinalPrescriptionV2View): boolean {
  return p.family === "dh_technical";
}

/**
 * The result-bearing drill: exactly one item in the main block(s), and it is
 * a drill. Zero or several (or a non-drill item there) → null: fail closed,
 * never an arbitrary pick.
 */
export function mainDrill(p: FinalPrescriptionV2View): DrillItemView | null {
  const items = p.blocks.filter((b) => b.role === "main").flatMap((b) => b.items);
  if (items.length !== 1 || items[0]!.kind !== "drill") return null;
  const drill = items[0]!;
  return Number.isInteger(drill.passes) && drill.passes > 0 ? drill : null;
}

export interface PassSlot {
  ordinal: number;
  result: SetResultRow | null;
}

export interface DhProgress {
  drill: DrillItemView;
  slots: PassSlot[];
  recorded: number;
  /** The first planned pass without a result (highlighted, never enforced). */
  current: PassSlot | null;
  /** Locked rule: at least one pass recorded (success value irrelevant). */
  canComplete: boolean;
  /** Some planned passes have no result: completing needs an explicit confirmation. */
  completionNeedsConfirmation: boolean;
}

/** `pending` = a pass about to be sent with the completion (same batch). */
export function dhProgress(p: FinalPrescriptionV2View, rows: readonly SetResultRow[], pending: readonly SetResultRow[] = []): DhProgress | null {
  const drill = mainDrill(p);
  if (!drill) return null;
  const active = activeResultsBySlot([...rows, ...pending]);
  const slots = Array.from({ length: drill.passes }, (_, i) => ({ ordinal: i + 1, result: active.get(slotKey(drill.prescriptionItemId, i + 1)) ?? null }));
  const recorded = slots.filter((s) => s.result !== null && s.result.done).length;
  return {
    drill,
    slots,
    recorded,
    current: slots.find((s) => s.result === null) ?? null,
    canComplete: recorded > 0,
    completionNeedsConfirmation: recorded > 0 && recorded < slots.length,
  };
}

/** The rider's answer to "was the success criterion met on this pass?". */
export type SuccessChoice = "yes" | "no" | "unrated";

export const successOf = (c: SuccessChoice): boolean | null => (c === "yes" ? true : c === "no" ? false : null);
export const choiceOf = (v: boolean | null): SuccessChoice => (v === true ? "yes" : v === false ? "no" : "unrated");
