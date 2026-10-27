import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { decodeFinalPrescriptionV2, decodePlannedPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { FinalPrescriptionV2Card } from "./FinalPrescriptionV2Card";
import { dhCountLabel, dhRecordedCountLabel } from "./dhRepetitionUnitLabels";
import type { DrillItemView } from "./finalPrescriptionV2Types";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";

// V2-DH-UNIT-01 (HPM 2026-10-26) — the web reads a DH count's stated unit (planned plan, today's prescription,
// History, guided session) and shows it; a historical count states none and keeps « passages »; a lost or
// falsified unit makes the document invalid — never silently dropped, never guessed.

function withMeasure(measure: Record<string, unknown>) {
  const { record } = keepFinalPrescription("DH_TECHNICAL");
  const drill = record.structure.blocks.find((b: { role: string }) => b.role === "main").items[0];
  drill.measure = { ...measure, count: drill.measure.count };
  return { record, count: drill.measure.count as number };
}
const drillOf = (r: ReturnType<typeof decodeFinalPrescriptionV2>) => {
  if (!r.ok) throw new Error(r.reason);
  return r.view.blocks.find((b) => b.role === "main")!.items[0] as DrillItemView;
};

describe("V2-DH-UNIT-01 · web decoder", () => {
  it("a historical count decodes unchanged: no unit, shown as « passages »", () => {
    const { record, count } = withMeasure({ type: "pass" });
    const drill = drillOf(decodeFinalPrescriptionV2(record));
    expect(drill).not.toHaveProperty("repetitionUnit");
    expect(drill).not.toHaveProperty("descentMinutes");
    render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: (decodeFinalPrescriptionV2(record) as { ok: true; view: never }).view }} />);
    expect(screen.getByText(`${count} passages`)).toBeInTheDocument();
  });

  it("SECTION and FULL_RUN decode with their unit, identically for today's prescription and the planned plan, and are shown as stated", () => {
    const section = withMeasure({ type: "pass", unit: "SECTION" });
    expect(drillOf(decodeFinalPrescriptionV2(section.record))).toMatchObject({ passes: section.count, repetitionUnit: "SECTION" });
    expect(drillOf(decodePlannedPrescriptionV2({ ...section.record, generatedPlanSessionId: "g-1" }))).toMatchObject({ repetitionUnit: "SECTION" });
    const fullRun = withMeasure({ type: "pass", unit: "FULL_RUN", descentMinutes: 4 });
    expect(drillOf(decodeFinalPrescriptionV2(fullRun.record))).toMatchObject({ passes: fullRun.count, repetitionUnit: "FULL_RUN", descentMinutes: 4 });
    const { unmount } = render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: (decodeFinalPrescriptionV2(section.record) as { ok: true; view: never }).view }} />);
    expect(screen.getByText(`${section.count} sections`)).toBeInTheDocument();
    unmount();
    render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: (decodeFinalPrescriptionV2(fullRun.record) as { ok: true; view: never }).view }} />);
    expect(screen.getByText(`${fullRun.count} descentes complètes`)).toBeInTheDocument();
  });

  it("a lost or falsified unit makes the whole document invalid (never dropped, never guessed)", () => {
    for (const measure of [
      { type: "pass", unit: "UNKNOWN" },
      { type: "pass", unit: "section" },
      { type: "pass", unit: "FULL_RUN" },
      { type: "pass", unit: "FULL_RUN", descentMinutes: 0 },
      { type: "pass", unit: "SECTION", descentMinutes: 4 },
      { type: "pass", descentMinutes: 4 },
      { type: "pass", repetitionUnit: "SECTION" },
    ]) {
      expect(decodeFinalPrescriptionV2(withMeasure(measure).record), JSON.stringify(measure)).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  it("labels: the unit in singular and plural; a historical count keeps its words", () => {
    expect([dhCountLabel(1), dhCountLabel(6), dhCountLabel(1, "SECTION"), dhCountLabel(6, "SECTION"), dhCountLabel(1, "FULL_RUN"), dhCountLabel(4, "FULL_RUN")]).toEqual([
      "1 passage",
      "6 passages",
      "1 section",
      "6 sections",
      "1 descente complète",
      "4 descentes complètes",
    ]);
    expect([dhRecordedCountLabel(0, 6), dhRecordedCountLabel(2, 6, "SECTION"), dhRecordedCountLabel(1, 4, "FULL_RUN")]).toEqual(["0 / 6 passages enregistrés", "2 / 6 sections enregistrées", "1 / 4 descentes complètes enregistrées"]);
  });
});

describe("V2-DH-UNIT-01 · guided DH session", () => {
  it("the planned count and the progress state the unit; results are still recorded pass by pass", async () => {
    const dh = prescriptionView("DH_TECHNICAL", (s) => {
      s.blocks.find((b: { role: string }) => b.role === "main").items[0].measure.unit = "SECTION";
    });
    const b = fakeBackend({ prescription: dh });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-phase")).toBe("active"));
    const drill = dh.blocks.find((x) => x.role === "main")!.items[0] as DrillItemView;
    expect(document.querySelector(`[data-item-id="${drill.prescriptionItemId}"]`)!.textContent).toContain(`Prévu : ${drill.passes} sections`);
    expect(screen.getByTestId("dh-progress")).toHaveTextContent(`0 / ${drill.passes} sections enregistrées`);
  });
});
