import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { keepFinalPrescription, type FixtureKind } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { FinalPrescriptionV2Card } from "./FinalPrescriptionV2Card";
import { strengthExtrasLine, strengthSummary, strengthSummaryLine } from "./strengthSummary";
import { decodePlannedPrescriptionV2 } from "./decodeFinalPrescriptionV2";
import { TrainingPlanSessionCard } from "../trainingPlanReview/components/TrainingPlanSessionCard";
import { assembleTrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewRepo";
import { sessionFocus } from "../program/programPresentation";
import type { TrainingPlanReviewSession } from "../trainingPlanReview/trainingPlanReviewTypes";
import type { ExerciseItemView, FinalPrescriptionV2View } from "./finalPrescriptionV2Types";

// A02 — a V2 Force session reads without interpretation: counts that say what
// they count (work exercises, work sets; warm-up and ramp-up apart), every
// work exercise with its sets × measure, RPE, rest, cue and role, the same
// content in Today, Program and the guided session, adapted sessions included.
// Fixtures are genuine engine documents (scripts/generate-final-prescription-v2-fixtures.mjs).

const summaryOf = (kind: FixtureKind) => strengthSummary(prescriptionView(kind))!;
const work = (p: FinalPrescriptionV2View) => strengthSummary(p)!.workExercises;

describe("A02 — what the counts mean (never a bare « 12 séries »)", () => {
  it.each([
    ["STRENGTH_LOWER", "3 exercices de travail · 10 séries de travail"],
    ["STRENGTH_UPPER", "3 exercices de travail · 9 séries de travail"],
    ["MODIFY_STRENGTH_LOWER", "3 exercices de travail · 7 séries de travail"],
    ["STRENGTH_LOWER_BUILD_PLUS", "3 exercices de travail · 12 séries de travail"],
    ["REPLACE_DH_TO_STRENGTH", "3 exercices de travail · 7 séries de travail"],
  ] as const)("%s: %s", (kind, line) => {
    expect(strengthSummaryLine(summaryOf(kind))).toBe(line);
  });

  it("warm-up exercises and ramp-up sets are named apart, never added to the work sets", () => {
    const s = summaryOf("STRENGTH_LOWER");
    const p = prescriptionView("STRENGTH_LOWER");
    const warmUp = p.blocks.filter((b) => b.role === "warm_up").flatMap((b) => b.items).length;
    expect(strengthExtrasLine(s)).toBe(`Non comptés : échauffement (${warmUp} exercices), montée en charge (1–2 séries).`);
    expect(s.workSets).toBe(work(p).reduce((n, i) => n + i.sets, 0));
  });

  it("C / D — LIGHT, MODERATE, MODERATE_PLUS: same exercises, 7 → 10 → 12 work sets, principal RPE 5–6 → 7–8 → 8", () => {
    const [light, moderate, plus] = (["MODIFY_STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_LOWER_BUILD_PLUS"] as const).map((k) => prescriptionView(k));
    expect(work(light!).map((i) => i.exerciseId)).toEqual(work(moderate!).map((i) => i.exerciseId));
    expect(work(plus!).map((i) => i.exerciseId)).toEqual(work(moderate!).map((i) => i.exerciseId));
    const principal = (p: FinalPrescriptionV2View) => work(p).find((i) => i.role === "principal")!;
    expect([light, moderate, plus].map((p) => [principal(p!).sets, principal(p!).rpeTarget])).toEqual([
      [3, { min: 5, max: 6 }],
      [4, { min: 7, max: 8 }],
      [5, { min: 8, max: 8 }],
    ]);
  });
});

describe("A02 — Today: the effective prescription, complete", () => {
  it.each(["STRENGTH_LOWER", "STRENGTH_UPPER", "MODIFY_STRENGTH_LOWER", "REPLACE_DH_TO_STRENGTH"] as const)("A / B / E / F — %s: summary, role, sets × measure, RPE, rest, cue of every work exercise; ramp-up on the principal", (kind) => {
    const p = prescriptionView(kind);
    render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: p }} />);
    expect(screen.getByTestId("strength-summary")).toHaveTextContent(strengthSummaryLine(strengthSummary(p)!));
    for (const item of work(p)) {
      const li = document.querySelector(`[data-item-id="${item.prescriptionItemId}"]`) as HTMLElement;
      expect(li.textContent).toContain(item.name);
      expect(li.textContent).toMatch(new RegExp(`${item.sets} séries? × `));
      expect(li.textContent).toContain("RPE");
      expect(li.textContent).toContain("Repos :");
      expect(li.textContent).toContain(`Consigne : ${item.cue}`);
    }
    const principal = work(p).find((i) => i.role === "principal")!;
    expect(document.querySelector(`[data-item-id="${principal.prescriptionItemId}"]`)!.textContent).toMatch(/Principal.*Montée en charge : 1–2 séries/);
  });

  it("E — a MODIFY Force shows its LIGHT dose, not the planned one", () => {
    render(<FinalPrescriptionV2Card state={{ kind: "created", prescription: prescriptionView("MODIFY_STRENGTH_LOWER") }} />);
    const principal = work(prescriptionView("MODIFY_STRENGTH_LOWER"))[0]!;
    expect(document.querySelector(`[data-item-id="${principal.prescriptionItemId}"]`)!.textContent).toContain("3 séries × 8–10 répétitions — RPE 5–6");
    expect(screen.queryByText(/4 séries × 6–8/)).toBeNull();
  });
});

describe("A02 — Program: a V2 planned Force opens on its real content", () => {
  const planned = keepFinalPrescription("STRENGTH_LOWER").record;
  const row = { id: "pp-1", generated_plan_session_id: "s-1", plan_version_id: "v-1", schema_version: "v2", catalog_version: planned.catalogVersion as string, structure: planned.structure };
  const review = assembleTrainingPlanReview(
    { id: "v-1", horizon_start_date: "2026-10-05", horizon_end_date: "2026-10-18", generation_trigger: "initial", rationale: "", relaxed_constraints: [], generated_at: "2026-10-04T10:00:00Z" } as never,
    "accepted",
    [{ id: "b-1", plan_version_id: "v-1", sequence_number: 1, name: "Plan", mode: "UNSPECIFIED", primary_focus: "x", start_date: "2026-10-05", end_date: "2026-10-18" }] as never,
    [{ id: "w-1", block_id: "b-1", plan_version_id: "v-1", week_number: 1, start_date: "2026-10-05", end_date: "2026-10-11", week_type: "development", dose_summary: {}, rationale: "" }] as never,
    [{ id: "s-1", week_id: "w-1", plan_version_id: "v-1", date: "2026-10-07", kind: "STRENGTH_LOWER", load_profile: "MODERATE", duration_min: 60, dose_target: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 }, rationale: "" }] as never,
    [row]
  );
  const session = review.blocks[0]!.weeks[0]!.sessions[0]! as TrainingPlanReviewSession;

  it("the planned v2 prescription is decoded by the same decoder as Today (supported, never « indisponible »)", () => {
    expect(session.prescription).toMatchObject({ status: "supported", schemaVersion: "v2" });
    expect(decodePlannedPrescriptionV2({ ...row, generatedPlanSessionId: row.generated_plan_session_id, schemaVersion: row.schema_version, catalogVersion: row.catalog_version })).toMatchObject({ ok: true });
  });

  it("the session card shows the exercises, work sets, RPE, rest; the legacy setVolume 12 never appears", () => {
    render(<TrainingPlanSessionCard session={session} />);
    expect(screen.getByText("Séance prévue")).toBeInTheDocument();
    expect(screen.getByTestId("strength-summary")).toHaveTextContent("3 exercices de travail · 10 séries de travail");
    expect(screen.getByText("60 min")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/(^|\D)12 séries/);
    expect(document.body.textContent).not.toContain("Le détail de cette séance n'est pas disponible");
  });

  it("the focus line is the first work exercise", () => {
    expect(sessionFocus(session)).toBe(work(prescriptionView("STRENGTH_LOWER"))[0]!.name);
  });
});

describe("A02 — Guided Force: progress and partial completion say what is missing (I), a correction counts once (J)", () => {
  const phase = () => screen.getByRole("status").getAttribute("data-phase");
  const LOWER = prescriptionView("STRENGTH_LOWER");
  const items = work(LOWER) as ExerciseItemView[];
  const row = (executionId: string, item: ExerciseItemView, n: number, extra: Record<string, unknown> = {}) => ({
    id: `dddddddd-0000-4000-8000-${item.prescriptionItemId.slice(-6)}${String(n).padStart(6, "0")}`,
    execution_id: executionId,
    prescription_item_id: item.prescriptionItemId,
    set_number: n,
    done: true as boolean,
    measure_type: "reps" as const,
    measure_value: 8 as number | null,
    load_kg: null,
    rpe_actual: null,
    supersedes_id: null as string | null,
    occurred_at: "2026-10-09T17:30:00Z",
    ...extra,
  });

  async function startWith(b: ReturnType<typeof fakeBackend>) {
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    return b.executions.at(-1)!.id;
  }

  it("I — one performed set and one set « non réalisée »: the progress counts them apart; completing names what is missing; F-6C allows it", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const executionId = await startWith(b);
    const r = await b.post({ events: [], sets: [row(executionId, items[0]!, 1), row(executionId, items[0]!, 2, { done: false, measure_value: null })] });
    expect(r.ok).toBe(true);
    // Reload (H): the confirmed results come back from the backend.
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(screen.getAllByTestId("strength-progress").at(-1)).toHaveTextContent("Séries de travail réalisées : 1 / 10 · 1 non réalisée"));
    const view = within(screen.getAllByRole("status").at(-1)!.closest("main") ?? document.body);
    await userEvent.click(view.getAllByRole("button", { name: "Terminer la séance" }).at(-1)!);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("1 série de travail réalisée sur 10 (8 séries de travail sans résultat, 1 série non réalisée). Terminer quand même la séance avec ces résultats ?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Terminer quand même" }));
    await waitFor(() => expect(b.executions.at(-1)!.execution_events.at(-1)!.event_type).toBe("completed"));
  });

  it("J — a corrected set counts once: original + correction = one performed set", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const executionId = await startWith(b);
    const original = row(executionId, items[0]!, 1, { measure_value: 6 });
    expect((await b.post({ events: [], sets: [original] })).ok).toBe(true);
    expect((await b.post({ events: [], sets: [row(executionId, items[0]!, 1, { id: "eeeeeeee-0000-4000-8000-000000000001", measure_value: 8, supersedes_id: original.id })] })).ok).toBe(true);
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(screen.getAllByTestId("strength-progress").at(-1)).toHaveTextContent("Séries de travail réalisées : 1 / 10"));
    expect(screen.getAllByTestId("strength-progress").at(-1)!.textContent).not.toContain("non réalisée");
  });
});
