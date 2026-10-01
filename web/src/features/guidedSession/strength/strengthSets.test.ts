import { describe, expect, it } from "vitest";
import { activeResultsBySlot, isGuidedStrengthPrescription, slotKey, strengthProgress, validateSetForm, workItems } from "./strengthSets";
import { prescriptionView } from "../../../test/guidedSessionFakeBackend";
import type { SetResultRow } from "../executionState";

const LOWER = prescriptionView("STRENGTH_LOWER");
const SQUAT = workItems(LOWER)[0]!.item;
const row = (id: string, setNumber: number, recorded: string, extra: Partial<SetResultRow> = {}): SetResultRow => ({
  id,
  prescription_item_id: SQUAT.prescriptionItemId,
  other_exercise_name: null,
  set_number: setNumber,
  done: true,
  measure_type: "reps",
  measure_value: 8,
  load_kg: null,
  rpe_actual: null,
  success: null,
  supersedes_id: null,
  occurred_at: recorded,
  recorded_at: recorded,
  ...extra,
});

describe("strengthSets — pure model (UX-11C.2)", () => {
  it("only STRENGTH_LOWER / STRENGTH_UPPER get the Force module", () => {
    expect(isGuidedStrengthPrescription(LOWER)).toBe(true);
    expect(isGuidedStrengthPrescription(prescriptionView("STRENGTH_UPPER"))).toBe(true);
    expect(isGuidedStrengthPrescription(prescriptionView("DH_TECHNICAL"))).toBe(false);
    expect(isGuidedStrengthPrescription(prescriptionView("AEROBIC_BASE"))).toBe(false);
  });

  it("work items = exercise items of main + complementary only, in prescription order", () => {
    expect(workItems(LOWER).map((w) => w.item.exerciseId)).toEqual(["goblet_squat", "dumbbell_romanian_deadlift", "bulgarian_split_squat"]);
  });

  it("a superseded row is never active, even if its recorded_at were later; the correction is", () => {
    const original = row("a", 1, "2026-10-09T18:05:00Z");
    const correction = row("b", 1, "2026-10-09T18:01:00Z", { supersedes_id: "a", measure_value: 7 });
    expect(activeResultsBySlot([original, correction]).get(slotKey(SQUAT.prescriptionItemId, 1))?.id).toBe("b");
  });

  it("two active rows for one set cannot exist since UX-11B.2.6 (unique original): the reader fails closed, it never picks one", () => {
    expect(() => activeResultsBySlot([row("a", 1, "2026-10-09T18:01:00Z"), row("b", 1, "2026-10-09T18:02:00Z")])).toThrow(/several active results/);
  });

  it("completion: 0 work results → no; partial → yes with confirmation; all → yes without; an 'other exercise' or a not-done row never counts", () => {
    expect(strengthProgress(LOWER, [])).toMatchObject({ recorded: 0, canComplete: false, completionNeedsConfirmation: false });
    expect(strengthProgress(LOWER, [row("x", 1, "t", { done: false, measure_value: null })])).toMatchObject({ canComplete: false });
    expect(strengthProgress(LOWER, [row("y", 1, "t", { prescription_item_id: null, other_exercise_name: "Tractions" })])).toMatchObject({ canComplete: false });
    expect(strengthProgress(LOWER, [row("a", 1, "t")])).toMatchObject({ recorded: 1, canComplete: true, completionNeedsConfirmation: true });
    const all = workItems(LOWER).flatMap(({ item }) => Array.from({ length: item.sets }, (_, i) => row(`${item.exerciseId}-${i}`, i + 1, "t", { prescription_item_id: item.prescriptionItemId })));
    expect(strengthProgress(LOWER, all)).toMatchObject({ recorded: 10, canComplete: true, completionNeedsConfirmation: false, current: null });
  });

  it("form validation mirrors the backend bounds (never looser) and never converts measures", () => {
    expect(validateSetForm("reps", { value: "8", rpe: "7,5", load: "22.25" })).toEqual({ ok: true, value: { measure_value: 8, rpe_actual: 7.5, load_kg: 22.25 } });
    expect(validateSetForm("duration", { value: "30", rpe: "", load: "" })).toEqual({ ok: true, value: { measure_value: 30, rpe_actual: null, load_kg: null } });
    for (const value of ["", "0", "7.5", "-1"]) expect(validateSetForm("reps", { value, rpe: "", load: "" }).ok).toBe(false);
    for (const rpe of ["0", "11", "7.25"]) expect(validateSetForm("reps", { value: "8", rpe, load: "" }).ok).toBe(false);
    for (const load of ["-1", "1000.5", "20.125"]) expect(validateSetForm("reps", { value: "8", rpe: "", load }).ok).toBe(false);
  });
});
