// UX-11C.2 — pure model of a guided Force session: which items take set
// results, which result is active for each prescribed set, the progression
// and the completion rule. Prescribed (the execution's own final
// prescription) and performed (exercise_set_results rows) are never mixed:
// a prescribed set without a row has NO result — never 0, skipped or done.
import type { ExerciseItemView, FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";
import type { SetResultRow } from "../executionState";
import { activeResultsBySlot, slotKey } from "../results/activeResults";

export { activeResultsBySlot, isCorrectable, slotKey } from "../results/activeResults";

export const STRENGTH_SESSION_KINDS = ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const;

/** Blocks whose exercise items take set results (warm_up and the ramp-up stay instructions) — one definition, shared with the prescription summary (A02). */
export { WORK_BLOCK_ROLES } from "../../finalPrescriptionV2/strengthSummary";
import { WORK_BLOCK_ROLES } from "../../finalPrescriptionV2/strengthSummary";

/** Measures a Force set result can carry in C.2 (duration in seconds, never converted to repetitions). */
export type StrengthMeasureType = "reps" | "duration";

export function isGuidedStrengthPrescription(p: FinalPrescriptionV2View): boolean {
  return p.family === "strength" && (STRENGTH_SESSION_KINDS as readonly string[]).includes(p.sessionKind);
}

export interface WorkItem {
  item: ExerciseItemView;
  /** null → fail-closed: this item's prescribed measure has no Force input (e.g. distance). */
  measureType: StrengthMeasureType | null;
}

export function workItems(p: FinalPrescriptionV2View): WorkItem[] {
  return p.blocks
    .filter((b) => (WORK_BLOCK_ROLES as readonly string[]).includes(b.role))
    .flatMap((b) => b.items)
    .filter((i): i is ExerciseItemView => i.kind === "exercise")
    .map((item) => ({ item, measureType: item.measure.type === "reps" || item.measure.type === "duration" ? item.measure.type : null }));
}

export interface StrengthSlot {
  item: ExerciseItemView;
  measureType: StrengthMeasureType | null;
  setNumber: number;
  result: SetResultRow | null;
}

export interface StrengthProgress {
  slots: StrengthSlot[];
  /** Prescribed work sets with an active, performed result. */
  recorded: number;
  /** A02 — prescribed work sets whose active result says « non réalisée » (done = false). */
  notDone: number;
  /** A02 — prescribed work sets without any result yet. */
  missing: number;
  /** The first prescribed work set without a result (highlighted, never enforced). */
  current: StrengthSlot | null;
  /** Locked rule: at least one active performed result on a main / complementary exercise. */
  canComplete: boolean;
  /** Some prescribed work sets have no result: completing needs an explicit confirmation. */
  completionNeedsConfirmation: boolean;
}

/** `pending` = a result about to be sent with the completion (same batch). */
export function strengthProgress(p: FinalPrescriptionV2View, rows: readonly SetResultRow[], pending: readonly SetResultRow[] = []): StrengthProgress {
  const active = activeResultsBySlot([...rows, ...pending]);
  const slots = workItems(p).flatMap(({ item, measureType }) =>
    Array.from({ length: item.sets }, (_, i) => ({ item, measureType, setNumber: i + 1, result: active.get(slotKey(item.prescriptionItemId, i + 1)) ?? null }))
  );
  const performed = (s: StrengthSlot) => s.result !== null && s.result.done;
  const recorded = slots.filter(performed).length;
  return {
    slots,
    recorded,
    notDone: slots.filter((s) => s.result !== null && !s.result.done).length,
    missing: slots.filter((s) => s.result === null).length,
    current: slots.find((s) => s.result === null && s.measureType !== null) ?? null,
    canComplete: recorded > 0,
    completionNeedsConfirmation: recorded > 0 && recorded < slots.length,
  };
}

// ---------------------------------------------------------------------------
// Entry form → set result (validated like the backend, never looser)
// ---------------------------------------------------------------------------

export interface SetFormValues {
  value: string;
  rpe: string;
  load: string;
}

export type SetFormErrors = Partial<Record<keyof SetFormValues, string>>;

export interface SetValues {
  measure_value: number;
  rpe_actual: number | null;
  load_kg: number | null;
}

const decimals = (s: string) => (s.includes(".") ? s.split(".")[1]!.length : 0);
const normalize = (s: string) => s.trim().replace(",", ".");

export function validateSetForm(measureType: StrengthMeasureType, form: SetFormValues): { ok: true; value: SetValues } | { ok: false; errors: SetFormErrors } {
  const errors: SetFormErrors = {};
  const value = normalize(form.value);
  const n = Number(value);
  if (value === "" || !/^\d+$/.test(value) || n < 1 || n > 2147483647) {
    errors.value = measureType === "reps" ? "Indique un nombre entier de répétitions (1 ou plus)." : "Indique une durée entière en secondes (1 ou plus).";
  }
  const rpeText = normalize(form.rpe);
  const rpe = rpeText === "" ? null : Number(rpeText);
  if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10 || decimals(rpeText) > 1)) errors.rpe = "Le RPE va de 1 à 10 (une décimale au plus).";
  const loadText = normalize(form.load);
  const load = loadText === "" ? null : Number(loadText);
  if (load !== null && (!Number.isFinite(load) || load < 0 || load > 1000 || decimals(loadText) > 2)) errors.load = "La charge va de 0 à 1000 kg (deux décimales au plus).";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { measure_value: n, rpe_actual: rpe, load_kg: load } };
}

export const formFromResult = (r: SetResultRow): SetFormValues => ({
  value: r.measure_value === null ? "" : String(r.measure_value),
  rpe: r.rpe_actual === null ? "" : String(r.rpe_actual),
  load: r.load_kg === null ? "" : String(r.load_kg),
});

export const isEmptyForm = (f: SetFormValues) => f.value.trim() === "" && f.rpe.trim() === "" && f.load.trim() === "";
