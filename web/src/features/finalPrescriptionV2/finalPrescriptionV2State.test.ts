import { beforeEach, describe, expect, it, vi } from "vitest";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";

const { from, eq } = vi.hoisted(() => {
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, eq };
});
vi.mock("../../lib/supabase", () => ({ supabase: { from } }));

import { finalPrescriptionV2StateFromResponse, FinalPrescriptionV2LoadError, loadFinalPrescriptionV2State } from "./finalPrescriptionV2State";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("live daily-run response → V2 state", () => {
  it("V1 response (no V2 status) → undefined: the V1 cards keep their behaviour", () => {
    expect(finalPrescriptionV2StateFromResponse({ decisionId: "d" })).toBeUndefined();
  });

  it("created + final prescription of this decision → decoded document", () => {
    const { live } = keepFinalPrescription("STRENGTH_LOWER");
    const state = finalPrescriptionV2StateFromResponse({ decisionId: live.decisionId, finalPrescriptionStatus: "created", finalPrescription: live });
    expect(state?.kind).toBe("created");
  });

  it("created without final prescription → final_prescription_missing (an inconsistency, not a blocked state)", () => {
    expect(finalPrescriptionV2StateFromResponse({ decisionId: "d", finalPrescriptionStatus: "created" })).toEqual({ kind: "final_prescription_missing" });
  });

  it("created with the final prescription of another decision → invalid", () => {
    const { live } = keepFinalPrescription("DH_TECHNICAL");
    expect(finalPrescriptionV2StateFromResponse({ decisionId: "another", finalPrescriptionStatus: "created", finalPrescription: live })?.kind).toBe("invalid");
  });

  it("not_required → REST state; blocked → code and detail", () => {
    expect(finalPrescriptionV2StateFromResponse({ decisionId: "d", finalPrescriptionStatus: "not_required" })).toEqual({ kind: "not_required" });
    expect(
      finalPrescriptionV2StateFromResponse({ decisionId: "d", finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_no_lineage", finalPrescriptionStatusDetail: { reason: "no_planned_session" } })
    ).toEqual({ kind: "blocked", code: "final_prescription_no_lineage", detail: { reason: "no_planned_session" } });
  });
});

describe("restore from the database → V2 state", () => {
  it("V1 / historical decision (no status) → undefined, no final prescription read", async () => {
    expect(await loadFinalPrescriptionV2State({ id: "d" })).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });

  it("created → reads decision_final_prescriptions by decision_id only, decodes the single row", async () => {
    const { row, live } = keepFinalPrescription("STRENGTH_LOWER");
    eq.mockResolvedValue({ data: [row], error: null });
    const state = await loadFinalPrescriptionV2State({ id: live.decisionId, finalPrescriptionStatus: "created", isLatestOfDay: true });
    expect(from).toHaveBeenCalledWith("decision_final_prescriptions");
    expect(eq).toHaveBeenCalledWith("decision_id", live.decisionId);
    expect(state?.kind).toBe("created");
    // Same content as the live response for the same document.
    expect(state).toEqual(finalPrescriptionV2StateFromResponse({ decisionId: live.decisionId, finalPrescriptionStatus: "created", finalPrescription: live }));
  });

  it("created but no row → final_prescription_missing; several rows → invalid", async () => {
    eq.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadFinalPrescriptionV2State({ id: "d", finalPrescriptionStatus: "created", isLatestOfDay: true })).toEqual({ kind: "final_prescription_missing" });
    const { row } = keepFinalPrescription("STRENGTH_LOWER");
    eq.mockResolvedValueOnce({ data: [row, row], error: null });
    expect((await loadFinalPrescriptionV2State({ id: row.decision_id, finalPrescriptionStatus: "created", isLatestOfDay: true }))?.kind).toBe("invalid");
  });

  it("REST and blocked are restored from the decision columns alone (no final prescription read)", async () => {
    expect(await loadFinalPrescriptionV2State({ id: "d", finalPrescriptionStatus: "not_required", isLatestOfDay: true })).toEqual({ kind: "not_required" });
    expect(
      await loadFinalPrescriptionV2State({ id: "d", finalPrescriptionStatus: "blocked", finalPrescriptionStatusCode: "final_prescription_adaptation_not_defined", finalPrescriptionStatusDetail: { reason: "modify_not_supported" }, isLatestOfDay: true })
    ).toEqual({ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported" } });
    expect(from).not.toHaveBeenCalled();
  });

  it("a V2 decision that is not the day's newest row is never shown as today's prescription", async () => {
    expect((await loadFinalPrescriptionV2State({ id: "d", finalPrescriptionStatus: "created", isLatestOfDay: false }))?.kind).toBe("invalid");
    expect(from).not.toHaveBeenCalled();
  });

  it("a read error is a load error, never 'no prescription'", async () => {
    eq.mockResolvedValue({ data: null, error: { code: "500" } });
    await expect(loadFinalPrescriptionV2State({ id: "d", finalPrescriptionStatus: "created", isLatestOfDay: true })).rejects.toThrow(FinalPrescriptionV2LoadError);
  });
});
