// PHYS-02 compatibility demonstration — runs inside a THROWAWAY checkout of REL-01 D (649a0a2), never committed:
// the previous web's own decoder, day card and guided endurance module, fed with genuine PHYS-02 engine documents.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "./phys02FinalPrescriptionV2.json";
import { decodeFinalPrescriptionV2, decodePlannedPrescriptionV2 } from "../features/finalPrescriptionV2/decodeFinalPrescriptionV2";
import { PrescriptionV2Details } from "../features/finalPrescriptionV2/FinalPrescriptionV2Card";
import { fakeBackend } from "../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../test/GuidedSessionHarness";
import type { FinalPrescriptionV2View } from "../features/finalPrescriptionV2/finalPrescriptionV2Types";

type Doc = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, any> };
const docs = fixtures.finalPrescriptions as unknown as Record<string, Doc>;
function view(key: string): FinalPrescriptionV2View {
  const r = docs[key]!;
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(`${key}: ${d.reason}`);
  return d.view;
}

describe("REL-01 D web × PHYS-02 documents", () => {
  it("decodes every PHYS-02 document (planned and final intervals, base with guidance, intervals → base); the guidance is ignored", () => {
    for (const key of Object.keys(docs)) expect(JSON.stringify(view(key))).not.toMatch(/enduranceGuidance|effortAboveTarget/);
    const p = fixtures.plannedPrescriptions.PLANNED_INTERVALS as unknown as Doc & { generatedPlanSessionId: string };
    const planned = decodePlannedPrescriptionV2({ id: p.id, generatedPlanSessionId: p.generatedPlanSessionId, schemaVersion: p.schemaVersion, catalogVersion: p.catalogVersion, structure: p.structure });
    expect(planned.ok).toBe(true);
    const v = view("KEEP_INTERVALS_GUIDED");
    expect(v.blocks.map((b) => [b.role, b.durationMinutes?.max, b.rpeTarget?.max ?? null])).toEqual([
      ["warm_up", 15, null],
      ["main", 3, 8], ["main", 2, null], ["main", 3, 8], ["main", 2, null], ["main", 3, 8], ["main", 2, null],
      ["main", 3, 8], ["main", 2, null], ["main", 3, 8], ["main", 2, null], ["main", 3, 8],
      ["cool_down", 10, null],
    ]);
  });

  it("the day's card shows the intervals block by block, with their instructions; no guidance", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_INTERVALS_GUIDED")} />);
    expect(screen.getAllByText("Pendant chaque répétition, tiens un effort soutenu et régulier, le même du début à la fin.")).toHaveLength(6);
    expect(screen.getAllByText("Entre les répétitions, continue très facilement pour récupérer.")).toHaveLength(5);
    expect(screen.queryByText(/Ta dernière séance/)).toBeNull();
  });

  it("the guided endurance module runs on an intervals document: planned 53 min, the activity recorded", async () => {
    const b = fakeBackend({ prescription: view("KEEP_INTERVALS_GUIDED") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByLabelText("Durée réalisée (minutes)")).toHaveAccessibleDescription("Prévu : 53 min"));
    await userEvent.click(screen.getByRole("radio", { name: "Home-trainer" }));
    await userEvent.type(screen.getByLabelText("Durée réalisée (minutes)"), "53");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer l'activité" }));
    await waitFor(() => expect(screen.getByTestId("activity-result")).toBeTruthy());
  });
});
