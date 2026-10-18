import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fixtures from "../../test/fixtures/phys04FinalPrescriptionV2.json";
import { decodeFinalPrescriptionV2, decodePlannedPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { FinalPrescriptionV2Card, PrescriptionV2Details } from "./FinalPrescriptionV2Card";
import type { ExerciseItemView, FinalPrescriptionV2View } from "./finalPrescriptionV2Types";
import { fakeBackend } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { translateExplanation } from "../trainingPlanReview/trainingPlanExplanationLabels";
import { resolveSessionModule } from "../guidedSession/sessionModules";
import { MOBILITY_COPY } from "../guidedSession/mobility/MobilitySessionModule";

// PHYS-04 — the mobility session and the bodyweight Force guidance on the web, from genuine engine
// documents (scripts/generate-phys04-fixtures.mjs): the routine guided movement by movement and
// completed without results; the repetitions to aim for, read from the rider's own recorded sets.

type Doc = { id: string; decisionId: string; schemaVersion: string; catalogVersion: string; structure: Record<string, unknown> };
const finals = fixtures.finalPrescriptions as unknown as Record<string, Doc>;
function view(key: string): FinalPrescriptionV2View {
  const r = finals[key]!;
  const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure: r.structure });
  if (!d.ok) throw new Error(`${key}: ${d.reason}`);
  return d.view;
}
const phase = () => screen.getByRole("status").getAttribute("data-phase");
const squat = (v: FinalPrescriptionV2View) => v.blocks.flatMap((b) => b.items).find((i): i is ExerciseItemView => i.kind === "exercise" && i.exerciseId === "bodyweight_squat")!;
const MOVEMENTS = [
  "Mobilité de hanches 90/90",
  "Mobilité des fléchisseurs de hanche",
  "Squat profond tenu",
  "Genou au mur (cheville)",
  "Dos rond, dos creux",
  "Mobilité thoracique en rotation",
  "Mobilité des poignets",
  "Respiration à expiration longue",
];

describe("PHYS-04 — the mobility session, readable", () => {
  it("the day's card: hips, ankles, spine, wrists, then breathing, each movement with its duration and cue; no load, no RPE", () => {
    render(<PrescriptionV2Details prescription={view("KEEP_MOBILITY")} />);
    expect([...document.querySelectorAll("[data-block-role]")].map((e) => e.getAttribute("data-block-role"))).toEqual(["main", "main", "main", "main", "cool_down"]);
    const text = document.body.textContent ?? "";
    const positions = MOVEMENTS.map((m) => text.indexOf(m));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).not.toMatch(/kg|RPE/);
  });

  it("the planned session reads as mobility in Program; the routine at its 22-minute minimum keeps the same movements", () => {
    const p = fixtures.plannedPrescriptions.PLANNED_MOBILITY as unknown as Doc & { generatedPlanSessionId: string };
    const planned = decodePlannedPrescriptionV2({ id: p.id, generatedPlanSessionId: p.generatedPlanSessionId, schemaVersion: p.schemaVersion, catalogVersion: p.catalogVersion, structure: p.structure });
    expect(planned.ok && planned.view.family).toBe("mobility");
    const min = view("A10_MOBILITY_MINIMUM");
    expect(min.blocks.map((b) => b.durationMinutes)).toEqual([
      { min: 9, max: 9 },
      { min: 3, max: 3 },
      { min: 5, max: 5 },
      { min: 2, max: 2 },
      { min: 3, max: 3 },
    ]);
    expect(min.blocks.flatMap((b) => b.items.map((i) => i.name))).toEqual(MOVEMENTS);
  });

  it("below the routine minimum: the precise reason, never a shorter routine", () => {
    const b = fixtures.blockedMobilityTooShort as unknown as { code: string; detail: Record<string, unknown> };
    render(<FinalPrescriptionV2Card state={{ kind: "blocked", code: b.code, detail: b.detail }} />);
    expect(screen.getByText("La séance de mobilité dure au moins 22 minutes : elle ne tient pas dans le temps que tu as aujourd'hui.")).toBeTruthy();
  });

  it("the week explanation names the mobility session in French", () => {
    expect(translateExplanation("A mobility session is added on a free day this week.", "week").text).toBe("Une séance de mobilité est ajoutée sur un jour libre cette semaine.");
  });
});

describe("PHYS-04 — guided mobility session: movement by movement, nothing to measure", () => {
  it("start → the 8 movements in order, one at a time → completion without any result", async () => {
    const v = view("KEEP_MOBILITY");
    expect(resolveSessionModule(v).kind).toBe("mobility");
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(screen.getByTestId("mobility-note")).toHaveTextContent(MOBILITY_COPY.note);
    const seen: string[] = [];
    for (let k = 0; k < MOVEMENTS.length; k += 1) {
      const step = screen.getByTestId("mobility-step");
      expect(step).toHaveTextContent(`Mouvement ${k + 1} sur ${MOVEMENTS.length}`);
      expect(step).toHaveTextContent(/Consigne : /);
      seen.push(MOVEMENTS.find((m) => step.textContent?.includes(m)) ?? "?");
      if (k < MOVEMENTS.length - 1) await userEvent.click(screen.getByRole("button", { name: MOBILITY_COPY.next }));
    }
    expect(seen).toEqual(MOVEMENTS);
    expect(screen.getByRole("button", { name: MOBILITY_COPY.next })).toBeDisabled();
    expect(screen.getByTestId("mobility-step")).toHaveTextContent(MOBILITY_COPY.last);
    await userEvent.click(screen.getByRole("button", { name: MOBILITY_COPY.previous }));
    expect(screen.getByTestId("mobility-step")).toHaveTextContent("Mouvement 7 sur 8");
    expect(screen.queryByLabelText(/Répétitions|Charge|Durée réalisée/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Terminer la séance" }));
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(b.executions[0]!.exercise_set_results).toEqual([]);
  });
});

describe("PHYS-04 — bodyweight Force: the repetitions to aim for, from the rider's own sets", () => {
  it("first time: the range and the reserve to keep, no target, no load", () => {
    render(<PrescriptionV2Details prescription={view("BODYWEIGHT_CALIBRATE")} />);
    const notes = screen.getAllByTestId("reps-guidance");
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.getAttribute("data-mode") === "calibrate")).toBe(true);
    expect(notes[0]!.textContent).toBe("Première fois : 8–10 répétitionsGarde 4–5 répétitions en réserve et note tes répétitions et ton RPE : la prochaine séance en tiendra compte.");
    expect(document.body.textContent).not.toMatch(/kg/);
  });

  it("every set at the bottom of the range, effort on target: one more repetition", () => {
    render(<PrescriptionV2Details prescription={view("BODYWEIGHT_PROGRESS")} />);
    const note = screen.getAllByTestId("reps-guidance")[0]!;
    expect(note.textContent).toBe("Vise 9 répétitions par sérieDernière fois 14 oct. : 8, 8, 8 (RPE 6) — une répétition de plus que ta série la plus courte.");
    expect(screen.getAllByTestId("reps-guidance")[2]!.textContent).toMatch(/^Vise 9 répétitions par côté par série/);
  });

  it("every set at the top of the range: keep the top; no harder bodyweight variant is invented", () => {
    render(<PrescriptionV2Details prescription={view("BODYWEIGHT_TOP_OF_RANGE")} />);
    const note = screen.getAllByTestId("reps-guidance")[0]!;
    expect(note.textContent).toBe(
      "Vise 10 répétitions par sérieDernière fois 14 oct. : 10, 10, 10 (RPE 6) — tu étais au haut de la fourchette. Pas encore de variante plus difficile sans matériel au catalogue : garde la qualité."
    );
    expect(view("BODYWEIGHT_TOP_OF_RANGE").blocks.flatMap((b) => b.items.map((i) => i.name))).toEqual(view("BODYWEIGHT_CALIBRATE").blocks.flatMap((b) => b.items.map((i) => i.name)));
  });

  it("guided set: the advised repetitions as a hint on the field, never prefilled; the set is recorded as entered", async () => {
    const v = view("BODYWEIGHT_PROGRESS");
    const b = fakeBackend({ prescription: v });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    await userEvent.click(screen.getByRole("button", { name: `Saisir la série 1 — ${squat(v).name}` }));
    const reps = screen.getByLabelText("Répétitions réalisées") as HTMLInputElement;
    expect(reps.value).toBe("");
    expect(document.getElementById(reps.getAttribute("aria-describedby")!.split(" ")[0]!)!.textContent).toBe("Conseillé : 9");
    await userEvent.type(reps, "9");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(b.executions[0]!.exercise_set_results).toMatchObject([{ set_number: 1, done: true, measure_type: "reps", measure_value: 9, load_kg: null }]));
  });

  it("an unreadable guidance is dropped, never a failure of the session", () => {
    const r = finals.BODYWEIGHT_PROGRESS!;
    const structure = JSON.parse(JSON.stringify(r.structure)) as { blocks: { items: Record<string, unknown>[] }[] };
    for (const b of structure.blocks) for (const i of b.items) if (i.repsGuidance) i.repsGuidance = { ruleVersion: "bodyweight-reps-guidance-v9", mode: "target" };
    const d = decodeFinalPrescriptionV2({ id: r.id, decisionId: r.decisionId, schemaVersion: r.schemaVersion, catalogVersion: r.catalogVersion, structure });
    expect(d.ok && squat(d.view).repsGuidance).toBeUndefined();
  });
});
