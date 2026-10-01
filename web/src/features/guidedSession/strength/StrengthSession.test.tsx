import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAY, fakeBackend, prescriptionView } from "../../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../../test/GuidedSessionHarness";
import { ACTION_ERROR_MESSAGES, COMPLETION_NOT_READY_MESSAGE, PARTIAL_COMPLETION_MESSAGE } from "../guidedSessionCopy";
import { STRENGTH_COPY } from "./strengthCopy";
import type { ExerciseItemView, FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";

// UX-11C.2 — guided Force sets, through the real shell + hook + module,
// against the in-memory backend double (record_session_execution rules).

const LOWER = prescriptionView("STRENGTH_LOWER");
const UPPER = prescriptionView("STRENGTH_UPPER");
const item = (p: FinalPrescriptionV2View, exerciseId: string) => p.blocks.flatMap((b) => b.items).find((i) => i.kind === "exercise" && i.exerciseId === exerciseId) as ExerciseItemView;
const SQUAT = item(LOWER, "goblet_squat");
const RDL = item(LOWER, "dumbbell_romanian_deadlift");
const SPLIT = item(LOWER, "bulgarian_split_squat");
const BENCH = item(UPPER, "dumbbell_bench_press");
const ROW = item(UPPER, "one_arm_dumbbell_row");

const phase = () => screen.getByRole("status").getAttribute("data-phase");
const completeButton = () => screen.getByRole("button", { name: "Terminer la séance" });

async function startSession() {
  await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
  await waitFor(() => expect(phase()).toBe("active"));
}
const slotButton = (verb: "Saisir" | "Modifier", n: number, it: ExerciseItemView) => screen.getByRole("button", { name: `${verb} la série ${n} — ${it.name}` });
const slotText = (it: ExerciseItemView, n: number) => within(document.querySelector(`[data-slot="${it.prescriptionItemId}#${n}"]`) as HTMLElement).getByTestId("slot-result").textContent;
async function fill(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  if (value !== "") await userEvent.type(input, value);
}
async function recordSet(it: ExerciseItemView, n: number, reps: string, extra: { rpe?: string; load?: string } = {}) {
  await userEvent.click(slotButton("Saisir", n, it));
  await fill("Répétitions réalisées" + ("perSide" in it.measure && it.measure.perSide ? " (par côté)" : ""), reps);
  if (extra.rpe) await fill("RPE ressenti (1–10, facultatif)", extra.rpe);
  if (extra.load) await fill("Charge utilisée en kg (facultatif)", extra.load);
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
  await waitFor(() => expect(slotText(it, n)).toMatch(/^Réalisé/));
}
/** Results recorded by another device / earlier, straight into the backend double. */
async function seed(b: ReturnType<typeof fakeBackend>, it: ExerciseItemView, setNumbers: number[]) {
  const executionId = b.executions.at(-1)!.id;
  const r = await b.post({
    events: [],
    sets: setNumbers.map((n) => ({ id: `bbbbbbbb-0000-4000-8000-${it.prescriptionItemId.slice(-6)}${String(n).padStart(6, "0")}`, execution_id: executionId, prescription_item_id: it.prescriptionItemId, set_number: n, done: true as const, measure_type: "reps" as const, measure_value: 8, load_kg: null, rpe_actual: null, supersedes_id: null, occurred_at: "2026-10-09T17:30:00Z" })),
  });
  if (!r.ok) throw new Error(r.error.code);
}
const allWorkSlots = (p: FinalPrescriptionV2View) => p.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items as ExerciseItemView[]);

describe("Guided Force session — rendering (UX-11C.2)", () => {
  it("LOWER: warm-up read only; main + complementary exercises with one slot per prescribed set (no row created); prescribed vs recorded", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    // Warm-up and ramp-up stay instructions: no result entry.
    const warmUp = document.querySelector('[data-block-role="warm_up"]') as HTMLElement;
    expect(within(warmUp).queryByRole("button")).toBeNull();
    expect(screen.getByText(/^Montée en charge :/)).toBeInTheDocument();
    // 4 / 3 / 3 prescribed sets → exactly that many slots, none recorded, nothing written.
    for (const [it, n] of [[SQUAT, 4], [RDL, 3], [SPLIT, 3]] as const) {
      expect(within(screen.getByRole("list", { name: `Séries — ${it.name}` })).getAllByRole("listitem")).toHaveLength(n);
      expect(slotText(it, n)).toBe(STRENGTH_COPY.noResult);
    }
    expect(screen.queryByRole("button", { name: `Saisir la série 5 — ${SQUAT.name}` })).toBeNull();
    expect(screen.getByTestId("strength-progress")).toHaveTextContent("Séries de travail enregistrées : 0 / 10");
    expect(b.executions[0]!.exercise_set_results).toEqual([]);
    expect((document.querySelector(`[data-item-id="${SQUAT.prescriptionItemId}"]`) as HTMLElement).textContent).toContain("Prévu : 4 séries × 6–8 répétitions · RPE 7–8 · repos 2–3 min");
    // The current set is highlighted in words, not only by colour.
    expect(within(document.querySelector(`[data-slot="${SQUAT.prescriptionItemId}#1"]`) as HTMLElement).getByText(STRENGTH_COPY.current)).toBeInTheDocument();
  });

  it("UPPER: its own work exercises and slots; per-side exercises say so in the entry", async () => {
    const b = fakeBackend({ prescription: UPPER });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(screen.getByTestId("strength-progress")).toHaveTextContent("0 / 9");
    expect(within(screen.getByRole("list", { name: `Séries — ${BENCH.name}` })).getAllByRole("listitem")).toHaveLength(4);
    await userEvent.click(slotButton("Saisir", 1, ROW));
    expect(screen.getByLabelText("Répétitions réalisées (par côté)")).toHaveFocus();
    expect(screen.getByText("Prévu : RPE 7")).toBeInTheDocument(); // prescribed RPE shown apart from the RPE entered
  });

  it("an unexpected measure on a work item (distance) fails closed for that item: no input", async () => {
    const withDistance = prescriptionView("STRENGTH_LOWER", (s) => {
      const it = s.blocks.flatMap((bl: any) => bl.items).find((i: any) => i.exerciseId === "dumbbell_romanian_deadlift");
      it.measure = { type: "distance", minMeters: 20, maxMeters: 30 };
    });
    const b = fakeBackend({ prescription: withDistance });
    render(<Harness deps={b.deps} />);
    await startSession();
    const card = document.querySelector(`[data-item-id="${RDL.prescriptionItemId}"]`) as HTMLElement;
    expect(within(card).getByText(STRENGTH_COPY.unsupportedItem)).toBeInTheDocument();
    expect(within(card).queryByRole("button")).toBeNull();
  });
});

describe("Guided Force session — recording sets", () => {
  it("records reps + actual RPE + load with a stable client id; the slot shows only the confirmed result", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordSet(SQUAT, 1, "8", { rpe: "7.5", load: "20" });
    const batch = b.post.mock.calls.at(-1)![0];
    expect(batch).toEqual({
      events: [],
      sets: [{ id: expect.any(String), execution_id: b.executions[0]!.id, prescription_item_id: SQUAT.prescriptionItemId, set_number: 1, done: true, measure_type: "reps", measure_value: 8, rpe_actual: 7.5, load_kg: 20, supersedes_id: null, occurred_at: "2026-10-09T17:00:00Z" }],
    });
    expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions · RPE 7.5 · 20 kg");
    expect(screen.getByTestId("strength-progress")).toHaveTextContent("1 / 10");
    expect(within(document.querySelector(`[data-slot="${SQUAT.prescriptionItemId}#2"]`) as HTMLElement).getByText(STRENGTH_COPY.current)).toBeInTheDocument();
    // Order is highlighted, never enforced: set 3 can be entered before set 2.
    await recordSet(SQUAT, 3, "6");
    expect(slotText(SQUAT, 2)).toBe(STRENGTH_COPY.noResult);
  });

  it("duration items take seconds (never converted to repetitions)", async () => {
    const withDuration = prescriptionView("STRENGTH_LOWER", (s) => {
      const it = s.blocks.flatMap((bl: any) => bl.items).find((i: any) => i.exerciseId === "bulgarian_split_squat");
      it.measure = { type: "duration", minSeconds: 20, maxSeconds: 30, perSide: true };
    });
    const b = fakeBackend({ prescription: withDuration });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(slotButton("Saisir", 1, SPLIT));
    await fill("Durée réalisée en secondes (par côté)", "25");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(slotText(SPLIT, 1)).toBe("Réalisé : 25 s par côté"));
    expect(b.post.mock.calls.at(-1)![0].sets![0]).toMatchObject({ measure_type: "duration", measure_value: 25 });
  });

  it("field validation is attached to the field; nothing is sent", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    const posts = b.post.mock.calls.length;
    await userEvent.click(slotButton("Saisir", 1, SQUAT));
    await fill("RPE ressenti (1–10, facultatif)", "11");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    const reps = screen.getByLabelText("Répétitions réalisées");
    expect(reps).toHaveAttribute("aria-invalid", "true");
    expect(reps).toHaveAccessibleDescription("Indique un nombre entier de répétitions (1 ou plus).");
    expect(screen.getByLabelText("RPE ressenti (1–10, facultatif)")).toHaveAccessibleDescription("Prévu : RPE 7–8 Le RPE va de 1 à 10 (une décimale au plus).");
    expect(b.post.mock.calls.length).toBe(posts);
  });

  it("network failure: the entry stays open and unconfirmed; retry re-sends the SAME id → one row", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    b.state.networkFailures = ["landed"];
    await userEvent.click(slotButton("Saisir", 1, SQUAT));
    await fill("Répétitions réalisées", "8");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(slotText(SQUAT, 1)).toBe(STRENGTH_COPY.noResult); // never "recorded" before the server confirms
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions"));
    const [first, second] = b.state.posts.slice(-2);
    expect(second).toEqual(first);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("re-submitting the same entry after a lost reply replays the same id (unchanged) → one row", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    b.state.networkFailures = ["landed"];
    await userEvent.click(slotButton("Saisir", 1, SQUAT));
    await fill("Répétitions réalisées", "8");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions"));
    expect(b.state.posts.at(-1)!.sets![0]!.id).toBe(b.state.posts.at(-2)!.sets![0]!.id);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("same id with different content after a lost reply → non-retryable conflict, the confirmed value is shown", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    b.state.networkFailures = ["landed"];
    await userEvent.click(slotButton("Saisir", 1, SQUAT));
    await fill("Répétitions réalisées", "8");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await screen.findByRole("alert");
    await fill("Répétitions réalisées", "9");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveAttribute("data-code", "id_conflict"));
    expect(screen.getByRole("alert")).toHaveTextContent(ACTION_ERROR_MESSAGES.id_conflict!);
    expect(within(screen.getByRole("alert")).queryByRole("button", { name: "Réessayer" })).toBeNull();
    expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions");
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("double submit of one entry → one request", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(slotButton("Saisir", 1, SQUAT));
    await fill("Répétitions réalisées", "8");
    const save = screen.getByRole("button", { name: "Enregistrer la série" });
    const posts = b.post.mock.calls.length;
    await act(async () => {
      save.click();
      save.click();
    });
    await waitFor(() => expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions"));
    expect(b.post.mock.calls.length).toBe(posts + 1);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("correction: « Modifier » opens the recorded values and appends a superseding row; only the active value is shown; never a correction of a correction", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordSet(SQUAT, 1, "8", { rpe: "8" });
    const original = b.executions[0]!.exercise_set_results[0]!;
    await userEvent.click(slotButton("Modifier", 1, SQUAT));
    expect(screen.getByLabelText("Répétitions réalisées")).toHaveValue(8);
    expect(screen.getByLabelText("RPE ressenti (1–10, facultatif)")).toHaveValue(8);
    await fill("Répétitions réalisées", "7");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(slotText(SQUAT, 1)).toBe(`Réalisé : 7 répétitions · RPE 8 · ${STRENGTH_COPY.corrected}`));
    const rows = b.executions[0]!.exercise_set_results;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(original); // history untouched (append-only)
    expect(rows[1]).toMatchObject({ supersedes_id: original.id, set_number: 1, prescription_item_id: SQUAT.prescriptionItemId, measure_value: 7 });
    expect(rows[1]!.id).not.toBe(original.id);
    expect(screen.queryByRole("button", { name: `Modifier la série 1 — ${SQUAT.name}` })).toBeNull();
    expect(screen.getByText(STRENGTH_COPY.correctedOnce)).toBeInTheDocument();
  });

  it("refresh restores the same execution, the 2 active results and the progression — no duplicate (also with a correction)", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const first = render(<Harness deps={b.deps} />);
    await startSession();
    await recordSet(SQUAT, 1, "8");
    await recordSet(SQUAT, 2, "7");
    await userEvent.click(slotButton("Modifier", 2, SQUAT));
    await fill("Répétitions réalisées", "6");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(slotText(SQUAT, 2)).toMatch(/^Réalisé : 6/));
    first.unmount();

    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.executions).toHaveLength(1);
    expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions");
    expect(slotText(SQUAT, 2)).toBe(`Réalisé : 6 répétitions · ${STRENGTH_COPY.corrected}`);
    expect(screen.getByTestId("strength-progress")).toHaveTextContent("2 / 10");
    expect(within(document.querySelector(`[data-slot="${SQUAT.prescriptionItemId}#3"]`) as HTMLElement).getByText(STRENGTH_COPY.current)).toBeInTheDocument();
    expect(b.executions[0]!.exercise_set_results).toHaveLength(3);
  });

  it("two tabs: both read the same execution; the second original for the same set is refused (result_slot_exists) and that tab reloads the confirmed value", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const tabA = render(<Harness deps={b.deps} />);
    await userEvent.click(await within(tabA.container).findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(within(tabA.container).getByRole("status")).toHaveAttribute("data-phase", "active"));
    const tabB = render(<Harness deps={b.deps} />);
    await waitFor(() => expect(within(tabB.container).getByRole("status")).toHaveAttribute("data-phase", "active"));
    const save = async (tab: typeof tabA, reps: string) => {
      await userEvent.click(within(tab.container).getByRole("button", { name: `Saisir la série 1 — ${SQUAT.name}` }));
      const input = within(tab.container).getByLabelText("Répétitions réalisées");
      await userEvent.type(input, reps);
      await userEvent.click(within(tab.container).getByRole("button", { name: "Enregistrer la série" }));
    };
    await save(tabA, "8");
    await save(tabB, "9"); // B still showed set 1 empty
    await waitFor(() => expect(within(tabB.container).getByRole("alert")).toHaveAttribute("data-code", "result_slot_exists"));
    expect(within(tabB.container).getAllByTestId("slot-result")[0]).toHaveTextContent("Réalisé : 8 répétitions");
    expect(b.executions[0]!.exercise_set_results.map((r) => r.measure_value)).toEqual([8]);
  });
});

describe("Guided Force session — completion", () => {
  it("zero work result → completion disabled with the reason", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveAccessibleDescription(STRENGTH_COPY.needOneWorkSet);
  });

  it("every prescribed work set has a result → direct completion (no confirmation); then read only", async () => {
    const b = fakeBackend({ prescription: UPPER });
    render(<Harness deps={b.deps} />);
    await startSession();
    for (const it of allWorkSlots(UPPER)) await seed(b, it, Array.from({ length: it.sets }, (_, i) => i + 1));
    await userEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reprendre" }));
    await waitFor(() => expect(screen.getByTestId("strength-progress")).toHaveTextContent("9 / 9"));
    await userEvent.click(completeButton());
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(b.post.mock.calls.at(-1)![0]).toEqual({ events: [{ id: expect.any(String), execution_id: b.executions[0]!.id, event_type: "completed", occurred_at: "2026-10-09T17:00:00Z" }] });
    // Terminal: read only — results kept, no entry, no correction, no restart.
    expect(screen.queryAllByRole("button", { name: /^(Saisir|Modifier) la série/ })).toEqual([]);
    expect(slotText(BENCH, 1)).toBe("Réalisé : 8 répétitions");
    expect(screen.queryByRole("button", { name: "Recommencer la séance" })).toBeNull();
  });

  it("partial results → confirmation (focus on the safe choice, Escape cancels) → completed with only the recorded results", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordSet(SQUAT, 1, "8");
    await userEvent.click(completeButton());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(PARTIAL_COMPLETION_MESSAGE);
    expect(within(dialog).getByRole("button", { name: "Revenir à la séance" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(phase()).toBe("active");
    await userEvent.click(completeButton());
    await userEvent.click(screen.getByRole("button", { name: "Terminer quand même" }));
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
    // Prescribed sets without a result stay without a result (never 0 / skipped / done).
    expect(slotText(SQUAT, 2)).toBe(STRENGTH_COPY.noResult);
  });

  it("the last set typed but not saved travels with `completed` in ONE batch; a lost batch leaves the session active and unrecorded", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    for (const it of allWorkSlots(LOWER)) await seed(b, it, Array.from({ length: it.sets }, (_, i) => i + 1).filter((n) => !(it === SPLIT && n === 3)));
    await userEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reprendre" }));
    await userEvent.click(await screen.findByRole("button", { name: `Saisir la série 3 — ${SPLIT.name}` }));
    await fill("Répétitions réalisées (par côté)", "9");
    b.state.networkFailures = ["lost"];
    await userEvent.click(completeButton()); // all sets covered with the typed one → no confirmation
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(phase()).toBe("active");
    expect(b.executions[0]!.exercise_set_results).toHaveLength(9);
    const sent = b.state.posts.at(-1)!;
    expect(sent.events.map((e) => e.event_type)).toEqual(["completed"]);
    expect(sent.sets).toEqual([expect.objectContaining({ prescription_item_id: SPLIT.prescriptionItemId, set_number: 3, measure_value: 9 })]);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(b.state.posts.at(-1)).toEqual(sent);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(10);
  });

  it("an invalid entry in progress blocks completion until saved or cancelled", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordSet(SQUAT, 1, "8");
    await userEvent.click(slotButton("Saisir", 2, SQUAT));
    await fill("Répétitions réalisées", "0");
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveAccessibleDescription(STRENGTH_COPY.finishEntryFirst);
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(completeButton()).toBeEnabled();
  });
});

describe("Guided Force session — abandon and restart", () => {
  it("abandoned: terminal, read only, sets kept; restart creates a NEW execution with new ids while the prescription is current", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordSet(SQUAT, 1, "8");
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    expect(screen.queryAllByRole("button", { name: /^(Saisir|Modifier) la série/ })).toEqual([]);
    expect(slotText(SQUAT, 1)).toBe("Réalisé : 8 répétitions");
    const e1 = b.executions[0]!.id;

    await userEvent.click(screen.getByRole("button", { name: "Recommencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.executions).toHaveLength(2);
    const e2 = b.executions[1]!;
    expect(e2.id).not.toBe(e1);
    expect(e2.final_prescription_id).toBe(LOWER.id);
    expect(e2.exercise_set_results).toEqual([]);
    expect(screen.getByTestId("strength-progress")).toHaveTextContent("0 / 10");
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1); // E1 stays history
  });

  it("restart is refused when the prescription is no longer current: nothing created, state reloaded", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    const restart = await screen.findByRole("button", { name: "Recommencer la séance" });
    b.setCurrent({ prescription: UPPER }); // a newer decision of the day
    await userEvent.click(restart);
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "final_prescription_not_current");
    expect(b.executions).toHaveLength(1);
    // The reloaded day offers the NEW prescription, never a restart of the stale one.
    expect(await screen.findByRole("button", { name: "Commencer la séance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recommencer la séance" })).toBeNull();
  });
});

describe("Endurance stays read only (UX-11C.4 not started)", () => {
  it.each(["AEROBIC_BASE"] as const)("%s: no result entry, completion disabled", async (kind) => {
    const b = fakeBackend({ prescription: prescriptionView(kind) });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(screen.getByTestId("results-placeholder")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Saisir/ })).toEqual([]);
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveAccessibleDescription(COMPLETION_NOT_READY_MESSAGE);
    expect(DAY).toBe("2026-10-09");
  });
});
