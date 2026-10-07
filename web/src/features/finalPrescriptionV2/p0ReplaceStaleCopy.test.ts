import { describe, expect, it } from "vitest";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";

// P0 replace stale copy — Guided reads the intent of the persisted final prescription:
// a DH adapted to LIGHT (intent dh_race_consistency) never shows « allure de course ».

describe("P0 — the intent shown is the effective prescription's intent", () => {
  it("dh_race_consistency resolves to its non-race text (the web mirror knows it)", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    record.structure.intentId = "dh_race_consistency";
    const r = decodeFinalPrescriptionV2(record);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.intent).toBe("Répéter la section avec régularité : même ligne, mêmes repères.");
      expect(r.view.intent).not.toMatch(/allure de course|mode course/);
    }
  });

  it("dh_race_pace still resolves to the race text for a kept race session", () => {
    const { record } = keepFinalPrescription("DH_TECHNICAL");
    record.structure.intentId = "dh_race_pace";
    const r = decodeFinalPrescriptionV2(record);
    expect(r.ok && r.view.intent).toBe("Tenir une allure de course du départ à l'arrivée.");
  });
});
