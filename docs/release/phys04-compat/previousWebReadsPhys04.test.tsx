// PHYS-04 compatibility demonstration — runs inside a THROWAWAY checkout of REL-01 D (649a0a2), never committed:
// the previous web's own decoder, day card and guided-session shell, fed with genuine PHYS-04 documents.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "./phys04FinalPrescriptionV2.json";
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

describe("REL-01 D web × PHYS-04 documents", () => {
  it("decodes every PHYS-04 document (mobility planned / final / minimum, bodyweight Force with guidance); the guidance is ignored", () => {
    expect(Object.keys(docs).map((k) => view(k).family)).toEqual(["mobility", "mobility", "strength", "strength", "strength"]);
    const p = fixtures.plannedPrescriptions.PLANNED_MOBILITY as unknown as Doc & { generatedPlanSessionId: string };
    expect(decodePlannedPrescriptionV2({ id: p.id, generatedPlanSessionId: p.generatedPlanSessionId, schemaVersion: p.schemaVersion, catalogVersion: p.catalogVersion, structure: p.structure }).ok).toBe(true);
    expect(JSON.stringify(view("BODYWEIGHT_PROGRESS"))).not.toMatch(/repsGuidance|targetReps/);
  });

  it("the day's card shows the whole routine; the bodyweight session without guidance", () => {
    const { unmount } = render(<PrescriptionV2Details prescription={view("KEEP_MOBILITY")} />);
    for (const name of ["Mobilité de hanches 90/90", "Squat profond tenu", "Dos rond, dos creux", "Mobilité des poignets", "Respiration à expiration longue"]) expect(screen.getByText(new RegExp(name))).toBeTruthy();
    unmount();
    render(<PrescriptionV2Details prescription={view("BODYWEIGHT_PROGRESS")} />);
    expect(screen.getByText(/Squat au poids du corps/)).toBeTruthy();
    expect(screen.queryByText(/Vise \d+ répétitions/)).toBeNull();
  });

  it("the guided shell opens the routine read only: completion not possible (degraded, never an error); the bodyweight session runs", async () => {
    const b = fakeBackend({ prescription: view("KEEP_MOBILITY") });
    const { unmount } = render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Terminer la séance" })).toBeDisabled());
    unmount();
    const s = fakeBackend({ prescription: view("BODYWEIGHT_PROGRESS") });
    render(<Harness deps={s.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await userEvent.click(await screen.findByRole("button", { name: /Saisir la série 1 — Squat au poids du corps/ }));
    await userEvent.type(screen.getByLabelText("Répétitions réalisées"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(s.executions[0]!.exercise_set_results).toMatchObject([{ set_number: 1, done: true, measure_value: 9 }]));
  });
});
