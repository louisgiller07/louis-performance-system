import { describe, expect, it } from "vitest";
import { choiceOf, dhProgress, isGuidedDhPrescription, mainDrill, successOf } from "./dhPasses";
import { prescriptionView } from "../../../test/guidedSessionFakeBackend";
import type { SetResultRow } from "../executionState";

const DH = prescriptionView("DH_TECHNICAL");
const DRILL = mainDrill(DH)!;
const pass = (id: string, ordinal: number, success: boolean | null, extra: Partial<SetResultRow> = {}): SetResultRow => ({
  id,
  prescription_item_id: DRILL.prescriptionItemId,
  other_exercise_name: null,
  set_number: ordinal,
  done: true,
  measure_type: "pass",
  measure_value: null,
  load_kg: null,
  rpe_actual: null,
  success,
  supersedes_id: null,
  occurred_at: "t",
  recorded_at: "t",
  ...extra,
});

describe("dhPasses — pure model (UX-11C.3)", () => {
  it("only dh_technical gets the DH module", () => {
    expect(isGuidedDhPrescription(DH)).toBe(true);
    expect(isGuidedDhPrescription(prescriptionView("STRENGTH_LOWER"))).toBe(false);
    expect(isGuidedDhPrescription(prescriptionView("AEROBIC_BASE"))).toBe(false);
  });

  it("the result-bearing item is the ONE main drill; none, several or a non-drill → null (fail closed)", () => {
    expect(DRILL).toMatchObject({ kind: "drill", passes: 6 });
    expect(mainDrill(prescriptionView("DH_TECHNICAL", (s) => (s.blocks.find((b: any) => b.role === "main").items = [])))).toBeNull();
    const twice = prescriptionView("DH_TECHNICAL", (s) => {
      const main = s.blocks.find((b: any) => b.role === "main");
      main.items = [main.items[0], { ...main.items[0], prescriptionItemId: "00000000-0000-4000-8000-0000000000fe" }];
    });
    expect(mainDrill(twice)).toBeNull();
    expect(mainDrill(prescriptionView("STRENGTH_LOWER"))).toBeNull();
  });

  it("completion never depends on success: one pass (even false / null) is enough; all passes → no confirmation", () => {
    expect(dhProgress(DH, [])).toMatchObject({ recorded: 0, canComplete: false, completionNeedsConfirmation: false });
    expect(dhProgress(DH, [pass("a", 1, false)])).toMatchObject({ recorded: 1, canComplete: true, completionNeedsConfirmation: true });
    const all = [1, 2, 3, 4, 5, 6].map((k) => pass(`p${k}`, k, null));
    expect(dhProgress(DH, all)).toMatchObject({ recorded: 6, canComplete: true, completionNeedsConfirmation: false, current: null });
  });

  it("the active pass is the correction when there is one", () => {
    const progress = dhProgress(DH, [pass("a", 2, false), pass("b", 2, true, { supersedes_id: "a" })])!;
    expect(progress.slots[1]!.result).toMatchObject({ id: "b", success: true });
    expect(progress.recorded).toBe(1);
  });

  it("Oui / Non / Non évalué ↔ true / false / null", () => {
    expect([successOf("yes"), successOf("no"), successOf("unrated")]).toEqual([true, false, null]);
    expect([choiceOf(true), choiceOf(false), choiceOf(null)]).toEqual(["yes", "no", "unrated"]);
  });
});
