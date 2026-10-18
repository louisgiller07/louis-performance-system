import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "../../test/fixtures/phys03FinalPrescriptionV2.json";
import { decodeFinalPrescriptionV2, decodePlannedPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { FinalPrescriptionV2Card, PrescriptionV2Details } from "./FinalPrescriptionV2Card";
import type { FinalPrescriptionV2View } from "./finalPrescriptionV2Types";
import { fakeBackend } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { translateExplanation } from "../trainingPlanReview/trainingPlanExplanationLabels";

// PHYS-03 — the power session on the web, from genuine engine documents (scripts/generate-phys03-fixtures.mjs):
// what it is (explosive exercises, sets, full rest, speed and quality, the stop rule), guided set by set
// without any load, and the precise reasons when it is not prescribed.

type Doc = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, unknown> };
const finals = fixtures.finalPrescriptions as unknown as Record<string, Doc>;
function view(key: string): FinalPrescriptionV2View {
  const r = finals[key]!;
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(`${key}: ${d.reason}`);
  return d.view;
}

describe("PHYS-03 — the power session, readable", () => {
  it("the day's card: 4 explosive exercises in order, sets and full rest, the speed / quality / stop rule, warm-up and cool-down", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_POWER_INTERMEDIATE")} />);
    expect(screen.getByText("4 exercices explosifs · 12 séries · repos complet entre les séries")).toBeTruthy();
    expect(screen.getByText("Non comptés : échauffement (4 exercices).")).toBeTruthy();
    expect(screen.getByTestId("power-guidance").textContent).toBe(
      "Chaque répétition à vitesse maximale, technique propre. Repos complet entre les séries. Arrête la série dès que la hauteur ou la vitesse baisse : la qualité compte plus que le nombre."
    );
    const main = [...document.querySelectorAll('[data-block-role="main"]')].map((b) => b.textContent ?? "");
    expect(main.map((t) => ["Squat sauté", "Saut en longueur sans élan", "Sauts latéraux du patineur", "Swing à l'haltère"].find((n) => t.includes(n)))).toEqual([
      "Squat sauté",
      "Saut en longueur sans élan",
      "Sauts latéraux du patineur",
      "Swing à l'haltère",
    ]);
    expect(main.every((t) => t.includes("Arrête la série dès que la hauteur ou la vitesse baisse."))).toBe(true);
    expect([...document.querySelectorAll("[data-block-role]")].map((e) => e.getAttribute("data-block-role"))).toEqual(["warm_up", "main", "main", "main", "main", "cool_down"]);
    expect(document.body.textContent).not.toMatch(/kg|RPE/);
  });

  it("an advanced rider without equipment: the plyometric push-up instead of the swing; Program reads the planned session the same way", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_POWER_ADVANCED_NO_EQUIPMENT")} />);
    expect(screen.getByText(/Pompes pliométriques/)).toBeTruthy();
    expect(screen.queryByText(/Swing/)).toBeNull();
    const p = fixtures.plannedPrescriptions.PLANNED_POWER_INTERMEDIATE as unknown as Doc & { generatedPlanSessionId: string };
    const planned = decodePlannedPrescriptionV2({ id: p.id, generatedPlanSessionId: p.generatedPlanSessionId, schemaVersion: p.schemaVersion, catalogVersion: p.catalogVersion, structure: p.structure });
    expect(planned.ok && planned.view.family).toBe("power");
  });

  it("the rider's time: 3 explosive exercises, same rest", () => {
    render(<PrescriptionV2Details prescription={view("A10_POWER_SHORTENED")} />);
    expect(screen.getByText("3 exercices explosifs · 9 séries · repos complet entre les séries")).toBeTruthy();
  });

  it("not prescribed today: the precise reason (lower load, fatigue), never an empty session", () => {
    for (const [key, text] of [
      ["blockedPowerLight", "la séance de puissance n'existe qu'en une seule version"],
      ["blockedPowerFatigue", "Fatigue des jambes ou des avant-bras signalée aujourd'hui"],
    ] as const) {
      const b = (fixtures as unknown as Record<string, { code: string; detail: Record<string, unknown> }>)[key]!;
      const { unmount } = render(<FinalPrescriptionV2Card state={{ kind: "blocked", code: b.code, detail: b.detail }} />);
      expect(screen.getByText(new RegExp(text))).toBeTruthy();
      unmount();
    }
  });

  it("the week explanation names the power session in French", () => {
    expect(translateExplanation("Build week: standard development load. This week's lower-body strength session is a power session.", "week").text).toBe(
      "Semaine de construction : charge de développement standard. Cette semaine, la séance de renfo bas du corps est une séance de puissance."
    );
  });
});

describe("PHYS-03 — guided power session: set by set, no load", () => {
  it("start → the 12 explosive sets to record (warm-up and cool-down read only) → a set recorded with its reps, no load asked → completion possible", async () => {
    const v = view("KEEP_POWER_INTERMEDIATE");
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 0 / 12"));
    for (const role of ["warm_up", "cool_down"]) expect(within(document.querySelector(`[data-block-role="${role}"]`) as HTMLElement).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Terminer la séance" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Saisir la série 1 — Squat sauté" }));
    expect(screen.queryByLabelText(/Charge utilisée/)).toBeNull();
    await userEvent.type(screen.getByLabelText("Répétitions réalisées"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 1 / 12"));
    expect(b.executions[0]!.exercise_set_results).toMatchObject([{ set_number: 1, done: true, measure_type: "reps", measure_value: 4, load_kg: null }]);
    expect(screen.getByRole("button", { name: "Terminer la séance" })).toBeEnabled();
  });
});
