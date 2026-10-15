import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "../../test/fixtures/phys01FinalPrescriptionV2.json";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { fakeBackend } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { PrescriptionV2Details } from "./FinalPrescriptionV2Card";
import { formatKg, formatLoad, loadFieldHint, loadGuidanceLines, shortDate } from "./loadGuidanceCopy";
import type { ExerciseItemView, ExerciseMeasureView, FinalPrescriptionV2View, LoadGuidanceView } from "./finalPrescriptionV2Types";

// PHYS-01.1 — the web side of the physical coaching path: genuine engine documents (daily cool-down,
// shortened session, load guidance from the rider's own history), still session-model-v2.6 — decoded,
// shown on the day's card and in the guided session; the previous runtime's documents stay readable.

type Fixture = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; adaptationRuleIds: string[]; structure: Record<string, any> };
const record = (key: keyof typeof fixtures.finalPrescriptions): Fixture => JSON.parse(JSON.stringify(fixtures.finalPrescriptions[key]));
function view(r: Fixture): FinalPrescriptionV2View {
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(d.reason);
  return d.view;
}
const exercise = (v: FinalPrescriptionV2View, id: string) => v.blocks.flatMap((b) => b.items).find((i) => i.kind === "exercise" && i.exerciseId === id) as ExerciseItemView;

const REPS: ExerciseMeasureView = { type: "reps", min: 6, max: 8, perSide: false };
const REF = { sessionDate: "2026-10-13", loadKg: 20, reps: [8, 8, 8, 8], setsPrescribed: 4, repsRange: { min: 6, max: 8 }, rpeMax: 7.5 };

describe("PHYS-01.1 — documents", () => {
  it("fixtures come from the engine and keep session-model-v2.6 (no version change)", () => {
    expect(fixtures.generatedFrom).toBe("session-model-v2.6");
    expect(record("SHORTENED_UPPER_30").adaptationRuleIds).toEqual(["v2.time.strength_shortened", "v2.time.today_limit"]);
  });

  it("decodes the daily cool-down and the load guidance (with its basis and its hold) of the work exercises only", () => {
    const v = view(record("GUIDED_KEEP_UPPER"));
    expect(v.blocks.map((b) => [b.role, b.roleLabel])).toEqual([
      ["warm_up", "Échauffement"],
      ["main", "Bloc principal"],
      ["complementary", "Complémentaire"],
      ["complementary", "Complémentaire"],
      ["cool_down", "Retour au calme"],
    ]);
    expect(exercise(v, "dumbbell_bench_press").loadGuidance).toMatchObject({ mode: "target", change: "increase", targetKg: 22, stepKg: 2, loadBasis: "per_dumbbell" });
    expect(exercise(v, "one_arm_dumbbell_row").loadGuidance).toMatchObject({ mode: "calibrate", reason: "no_history", loadBasis: "per_dumbbell" });
    expect(v.blocks.filter((b) => b.role === "warm_up" || b.role === "cool_down").flatMap((b) => b.items).some((i) => i.kind === "exercise" && i.loadGuidance)).toBe(false);
    expect(exercise(view(record("GUIDED_KEEP_UPPER_PAIN")), "dumbbell_bench_press").loadGuidance).toMatchObject({ change: "keep", hold: "pain", targetKg: 20 });
  });

  it("a malformed guidance (or a hold on an increase) is dropped — never shown as a guess — and the session stays readable", () => {
    const bad = record("GUIDED_KEEP_UPPER");
    bad.structure.blocks.find((b: { role: string }) => b.role === "main").items[0].loadGuidance.targetKg = "22 kg";
    expect(exercise(view(bad), "dumbbell_bench_press").loadGuidance).toBeUndefined();
    const held = record("GUIDED_KEEP_UPPER");
    held.structure.blocks.find((b: { role: string }) => b.role === "main").items[0].loadGuidance.hold = "pain";
    expect(exercise(view(held), "dumbbell_bench_press").loadGuidance).toBeUndefined();
    expect(exercise(view(held), "dumbbell_bench_press").sets).toBe(4);
  });

  it("the previous runtime's documents (no cool-down, no guidance) stay readable", () => {
    const { record: d } = keepFinalPrescription("STRENGTH_UPPER");
    expect(d.catalogVersion).toBe("session-model-v2.6");
    expect(decodeFinalPrescriptionV2(d).ok).toBe(true);
  });
});

describe("PHYS-01.1 — what the rider reads", () => {
  const lines = (g: LoadGuidanceView, m: ExerciseMeasureView = REPS) => loadGuidanceLines(g, m);

  it("+1 step, per dumbbell: the load, the step and why, from the rider's own last session", () => {
    expect(lines({ mode: "target", reason: "top_of_range_reached", change: "increase", targetKg: 22, stepKg: 2, loadBasis: "per_dumbbell", reference: REF })).toEqual({
      headline: "Charge conseillée : 22 kg par haltère (+2 kg)",
      detail: "Le 13 oct. : toutes tes séries à 20 kg par haltère au haut de la fourchette (8 répétitions), RPE 7.5 au plus. On monte d'un cran. Si cette charge n'est pas disponible, prends la plus proche et note-la.",
      suggestedKg: 22,
    });
  });

  it("a held increase says why: pain, fatigue, or a heavier dose today", () => {
    const held = (hold: "pain" | "fatigue" | "dose_up") => lines({ mode: "target", reason: "top_of_range_reached", change: "keep", hold, targetKg: 55, stepKg: 2.5, loadBasis: "total", reference: { ...REF, loadKg: 55, rpeMax: 8 } });
    expect(held("pain").headline).toBe("Charge conseillée : 55 kg (comme la dernière fois)");
    expect(held("pain").detail).toMatch(/au haut de la fourchette \(8 répétitions\), RPE 8 au plus, mais tu as signalé une douleur aujourd'hui : pas d'augmentation, garde cette charge\./);
    expect(held("fatigue").detail).toMatch(/mais ton état du jour montre de la fatigue : pas d'augmentation/);
    expect(held("dose_up").detail).toMatch(/déjà plus exigeante \(plus de séries ou un effort cible plus haut\) : une seule progression à la fois/);
  });

  it("same load / −1 step: the rule in plain words", () => {
    expect(lines({ mode: "target", reason: "within_range", change: "keep", targetKg: 20, stepKg: 2, loadBasis: "total", reference: { ...REF, reps: [8, 7, 7, 6] } }).detail).toMatch(/^Le 13 oct\. : séries de 8, 7, 7, 6 à 20 kg\. Monte quand toutes tes séries atteignent 8 répétitions/);
    expect(lines({ mode: "target", reason: "below_range", change: "decrease", targetKg: 57.5, stepKg: 2.5, loadBasis: "total", reference: { ...REF, loadKg: 60 } }).headline).toBe("Charge conseillée : 57,5 kg (−2,5 kg)");
  });

  it("calibration and references: never a number the rider did not record; dumbbells counted one at a time", () => {
    expect(lines({ mode: "calibrate", reason: "no_history", loadBasis: "per_dumbbell", repsInReserve: { min: 2, max: 3 } })).toEqual({
      headline: "Charge : à trouver aujourd'hui",
      detail: "Choisis une charge qui te laisse 2 à 3 répétitions en réserve à la fin de chaque série. Note la charge utilisée : NALYNT s'en servira à la prochaine séance. Indique la charge d'un seul haltère.",
      suggestedKg: null,
    });
    const other = lines({ mode: "reference", reason: "different_dose", loadBasis: "total", reference: REF, repsInReserve: { min: 4, max: 5 } }, { type: "reps", min: 8, max: 10, perSide: false });
    expect(other.headline).toBe("Charge : repère 20 kg (dernière séance)");
    expect(other.suggestedKg).toBeNull();
    expect(loadFieldHint({ mode: "calibrate", reason: "no_history", loadBasis: "per_dumbbell", repsInReserve: null }, REPS)).toBe("Charge d'un seul haltère.");
    expect(loadFieldHint({ mode: "target", reason: "top_of_range_reached", change: "increase", targetKg: 22, stepKg: 2, loadBasis: "per_dumbbell", reference: REF }, REPS)).toBe("Conseillé : 22 kg par haltère. Charge d'un seul haltère.");
  });

  it("formats", () => {
    expect([shortDate("2026-01-05"), shortDate("2026-12-31"), formatKg(57.5), formatLoad(20, "per_dumbbell")]).toEqual(["5 janv.", "31 déc.", "57,5 kg", "20 kg par haltère"]);
  });
});

describe("PHYS-01.1 — the day's card and the guided session", () => {
  it("the day's card: each loaded work exercise with its guidance; the cool-down shown", () => {
    render(<PrescriptionV2Details prescription={view(record("GUIDED_KEEP_UPPER"))} />);
    const notes = screen.getAllByTestId("load-guidance");
    expect(notes.map((n) => n.getAttribute("data-mode"))).toEqual(["target", "calibrate"]);
    expect(notes[0]!.textContent).toContain("Charge conseillée : 22 kg par haltère (+2 kg)");
    expect(screen.getByText("Retour au calme")).toBeTruthy();
  });

  it("the guided session: the guidance under each loaded exercise, the advised load and its basis next to the load field (never pre-filled), the cool-down read only", async () => {
    const v = view(record("GUIDED_KEEP_UPPER"));
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-phase")).toBe("active"));
    const bench = exercise(v, "dumbbell_bench_press");
    const card = document.querySelector(`[data-item-id="${bench.prescriptionItemId}"]`) as HTMLElement;
    expect(within(card).getByTestId("load-guidance").textContent).toContain("Charge conseillée : 22 kg par haltère (+2 kg)");
    await userEvent.click(screen.getByRole("button", { name: `Saisir la série 1 — ${bench.name}` }));
    expect(screen.getByText("Conseillé : 22 kg par haltère. Charge d'un seul haltère.")).toBeTruthy();
    expect((screen.getByLabelText("Charge utilisée en kg (facultatif)") as HTMLInputElement).value).toBe("");
    const coolDown = document.querySelector('[data-block-role="cool_down"]') as HTMLElement;
    expect(within(coolDown).getByText("Retour au calme")).toBeTruthy();
    expect(within(coolDown).queryByRole("button")).toBeNull();
  });

  it("the 30-minute session: warm-up, the principal at its dose, the cool-down's mobility; only the principal's sets are work sets", async () => {
    const v = view(record("SHORTENED_UPPER_30"));
    expect(v.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "cool_down"]);
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 0 / 4"));
  });
});
