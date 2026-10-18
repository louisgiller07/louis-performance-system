// PHYS-03 compatibility demonstration — runs inside a THROWAWAY checkout of REL-01 D (649a0a2), never committed:
// the previous web's own decoder, day card and guided-session shell, fed with genuine PHYS-03 power documents.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "./phys03FinalPrescriptionV2.json";
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

describe("REL-01 D web × PHYS-03 power documents", () => {
  it("decodes every PHYS-03 document (planned and final, shortened): family power, explosive exercises", () => {
    for (const key of Object.keys(docs)) expect(view(key).family).toBe("power");
    const p = fixtures.plannedPrescriptions.PLANNED_POWER_INTERMEDIATE as unknown as Doc & { generatedPlanSessionId: string };
    expect(decodePlannedPrescriptionV2({ id: p.id, generatedPlanSessionId: p.generatedPlanSessionId, schemaVersion: p.schemaVersion, catalogVersion: p.catalogVersion, structure: p.structure }).ok).toBe(true);
    expect(view("KEEP_POWER_INTERMEDIATE").blocks.map((b) => b.role)).toEqual(["warm_up", "main", "main", "main", "main", "cool_down"]);
  });

  it("the day's card shows the whole power session block by block, with the stop rule", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_POWER_INTERMEDIATE")} />);
    for (const name of ["Squat sauté", "Saut en longueur sans élan", "Sauts latéraux du patineur", "Swing à l'haltère"]) expect(screen.getByText(new RegExp(name))).toBeTruthy();
    expect(screen.getAllByText(/Arrête la série dès que la hauteur ou la vitesse baisse/).length).toBe(4);
  });

  it("the guided shell opens it read only: no set entry, completion not possible (degraded, never an error)", async () => {
    const b = fakeBackend({ prescription: view("KEEP_POWER_INTERMEDIATE") });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Terminer la séance" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: /Saisir la série/ })).toBeNull();
  });
});
