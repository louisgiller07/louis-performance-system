import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "../../test/fixtures/phys01FinalPrescriptionV2.json";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { fakeBackend } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { decodeFinalPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { PrescriptionV2Details } from "./FinalPrescriptionV2Card";
import { formatKg, loadGuidanceLines, shortDate } from "./loadGuidanceCopy";
import type { ExerciseItemView, ExerciseMeasureView, FinalPrescriptionV2View, LoadGuidanceView } from "./finalPrescriptionV2Types";

// PHYS-01 — the web side of the physical coaching path: genuine session-model-v2.7 documents (cool-down,
// short Force, load guidance from the rider's own history), decoded, shown on the day's card and in the
// guided session; v2.6 documents (production) stay readable.

type Fixture = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, any> };
const record = (key: keyof typeof fixtures.finalPrescriptions): Fixture => JSON.parse(JSON.stringify(fixtures.finalPrescriptions[key]));
function view(r: Fixture): FinalPrescriptionV2View {
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(d.reason);
  return d.view;
}
const exercise = (v: FinalPrescriptionV2View, id: string) => v.blocks.flatMap((b) => b.items).find((i) => i.kind === "exercise" && i.exerciseId === id) as ExerciseItemView;

const REPS: ExerciseMeasureView = { type: "reps", min: 6, max: 8, perSide: false };
const REF = { sessionDate: "2026-10-13", loadKg: 20, reps: [8, 8, 8, 8], setsPrescribed: 4, repsRange: { min: 6, max: 8 }, rpeMax: 7.5 };

describe("PHYS-01 — documents", () => {
  it("v2.7 fixtures come from the engine: guided KEEP and the short Force (27 min)", () => {
    expect(fixtures.generatedFrom).toBe("session-model-v2.7");
    expect(record("SHORT_UPPER_30").adaptationRuleIds).toEqual(["v2.time.strength_short", "v2.time.today_limit"]);
  });

  it("decodes the cool-down and the load guidance of the work exercises; warm-up / cool-down never carry one", () => {
    const v = view(record("GUIDED_KEEP_UPPER"));
    expect(v.blocks.map((b) => [b.role, b.roleLabel])).toEqual([
      ["warm_up", "Échauffement"],
      ["main", "Bloc principal"],
      ["complementary", "Complémentaire"],
      ["complementary", "Complémentaire"],
      ["cool_down", "Retour au calme"],
    ]);
    expect(exercise(v, "dumbbell_bench_press").loadGuidance).toMatchObject({ mode: "target", change: "increase", targetKg: 22, stepKg: 2 });
    expect(exercise(v, "one_arm_dumbbell_row").loadGuidance).toMatchObject({ mode: "calibrate", reason: "no_history" });
    expect(v.blocks.filter((b) => b.role === "warm_up" || b.role === "cool_down").flatMap((b) => b.items).some((i) => i.kind === "exercise" && i.loadGuidance)).toBe(false);
  });

  it("a malformed guidance is dropped (never shown as a guess) and the session stays readable", () => {
    const r = record("GUIDED_KEEP_UPPER");
    r.structure.blocks.find((b: { role: string }) => b.role === "main").items[0].loadGuidance.targetKg = "22 kg";
    const v = view(r);
    expect(exercise(v, "dumbbell_bench_press").loadGuidance).toBeUndefined();
    expect(exercise(v, "dumbbell_bench_press").sets).toBe(4);
  });

  it("v2.6 documents (production plans, no cool-down, no guidance) stay readable", () => {
    const { record: v26 } = keepFinalPrescription("STRENGTH_UPPER");
    expect(v26.catalogVersion).toBe("session-model-v2.6");
    expect(decodeFinalPrescriptionV2(v26).ok).toBe(true);
  });

  it("an unknown future manifest is still refused (never resolved with the current tables)", () => {
    const r = record("GUIDED_KEEP_UPPER");
    r.structure.catalog = { ...r.structure.catalog, aggregate: "session-model-v2.8" };
    r.catalogVersion = "session-model-v2.8";
    expect(decodeFinalPrescriptionV2(r).ok).toBe(false);
  });
});

describe("PHYS-01 — what the rider reads", () => {
  const lines = (g: LoadGuidanceView, m: ExerciseMeasureView = REPS) => loadGuidanceLines(g, m);

  it("+1 step: the load, the step and why, from the rider's own last session", () => {
    expect(lines({ mode: "target", reason: "top_of_range_reached", change: "increase", targetKg: 22, stepKg: 2, reference: REF })).toEqual({
      headline: "Charge conseillée : 22 kg (+2 kg)",
      detail: "Le 13 oct. : toutes tes séries à 20 kg au haut de la fourchette (8 répétitions), RPE 7.5 au plus. On monte d'un cran. Si cette charge n'est pas disponible, prends la plus proche et note-la.",
      suggestedKg: 22,
    });
  });

  it("same load / −1 step: the rule said in plain words", () => {
    expect(lines({ mode: "target", reason: "within_range", change: "keep", targetKg: 20, stepKg: 2, reference: { ...REF, reps: [8, 7, 7, 6] } }).headline).toBe("Charge conseillée : 20 kg (comme la dernière fois)");
    expect(lines({ mode: "target", reason: "within_range", change: "keep", targetKg: 20, stepKg: 2, reference: { ...REF, reps: [8, 7, 7, 6] } }).detail).toMatch(/^Le 13 oct\. : séries de 8, 7, 7, 6 à 20 kg\. Monte quand toutes tes séries atteignent 8 répétitions/);
    expect(lines({ mode: "target", reason: "below_range", change: "decrease", targetKg: 57.5, stepKg: 2.5, reference: { ...REF, loadKg: 60 } }).headline).toBe("Charge conseillée : 57,5 kg (−2,5 kg)");
    expect(lines({ mode: "target", reason: "effort_too_high", change: "decrease", targetKg: 18, stepKg: 2, reference: { ...REF, rpeMax: 10 } }).detail).toMatch(/l'effort est monté à RPE 10 à 20 kg, au-dessus de l'effort prévu : on redescend d'un cran\./);
  });

  it("calibration and references: never a number the rider did not record", () => {
    const calib = lines({ mode: "calibrate", reason: "no_history", repsInReserve: { min: 2, max: 3 } });
    expect(calib).toEqual({
      headline: "Charge : à trouver aujourd'hui",
      detail: "Choisis une charge qui te laisse 2 à 3 répétitions en réserve à la fin de chaque série. Note la charge utilisée : NALYNT s'en servira à la prochaine séance.",
      suggestedKg: null,
    });
    const other = lines({ mode: "reference", reason: "different_dose", reference: REF, repsInReserve: { min: 4, max: 5 } }, { type: "reps", min: 8, max: 10, perSide: false });
    expect(other.headline).toBe("Charge : repère 20 kg (dernière séance)");
    expect(other.detail).toBe("Le 13 oct. : 4 séries de 8 à 20 kg pour 6–8 répétitions. Aujourd'hui, la séance change (8–10 répétitions) : ajuste la charge pour garder 4 à 5 répétitions en réserve.");
    expect(other.suggestedKg).toBeNull();
    expect(lines({ mode: "reference", reason: "history_too_old", reference: REF, repsInReserve: { min: 2, max: 3 } }).detail).toMatch(/date de plus de 4 semaines : commence plus léger/);
  });

  it("formats", () => {
    expect([shortDate("2026-01-05"), shortDate("2026-12-31"), formatKg(57.5), formatKg(20)]).toEqual(["5 janv.", "31 déc.", "57,5 kg", "20 kg"]);
  });
});

describe("PHYS-01 — the day's card and the guided session", () => {
  it("the day's card: each work exercise with its load guidance; the cool-down shown", () => {
    render(<PrescriptionV2Details prescription={view(record("GUIDED_KEEP_UPPER"))} />);
    const notes = screen.getAllByTestId("load-guidance");
    expect(notes.map((n) => n.getAttribute("data-mode"))).toEqual(["target", "calibrate"]);
    expect(notes[0]!.textContent).toContain("Charge conseillée : 22 kg (+2 kg)");
    expect(screen.getByText("Retour au calme")).toBeTruthy();
  });

  it("the guided session: the guidance under each loaded exercise, the advised load next to the load field (never pre-filled), the cool-down read only", async () => {
    const v = view(record("GUIDED_KEEP_UPPER"));
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-phase")).toBe("active"));
    const bench = exercise(v, "dumbbell_bench_press");
    const card = document.querySelector(`[data-item-id="${bench.prescriptionItemId}"]`) as HTMLElement;
    expect(within(card).getByTestId("load-guidance").textContent).toContain("Charge conseillée : 22 kg (+2 kg)");
    await userEvent.click(screen.getByRole("button", { name: `Saisir la série 1 — ${bench.name}` }));
    expect(screen.getByText("Conseillé : 22 kg")).toBeTruthy();
    expect((screen.getByLabelText("Charge utilisée en kg (facultatif)") as HTMLInputElement).value).toBe("");
    const coolDown = document.querySelector('[data-block-role="cool_down"]') as HTMLElement;
    expect(within(coolDown).getByText("Retour au calme")).toBeTruthy();
    expect(within(coolDown).queryByRole("button")).toBeNull();
  });

  it("the short Force: warm-up, two work exercises, the cool-down's mobility; the work sets count only what is prescribed", async () => {
    const v = view(record("SHORT_UPPER_30"));
    expect(v.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "complementary", "cool_down"]);
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress").textContent).toBe("Séries de travail réalisées : 0 / 5"));
  });
});
