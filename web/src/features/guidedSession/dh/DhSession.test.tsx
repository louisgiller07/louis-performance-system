import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBackend, prescriptionView } from "../../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../../test/GuidedSessionHarness";
import { DH_COPY } from "./dhCopy";
import { mainDrill } from "./dhPasses";
import type { DrillItemView, FinalPrescriptionV2View } from "../../finalPrescriptionV2/finalPrescriptionV2Types";

// UX-11C.3 — guided DH passes, through the real shell + hook + module,
// against the in-memory backend double (record_session_execution rules,
// UX-11B.2.6 included).

const withPasses = (count: number) =>
  prescriptionView("DH_TECHNICAL", (s) => {
    s.blocks.find((b: any) => b.role === "main").items[0].measure.count = count;
  });
const DH = prescriptionView("DH_TECHNICAL"); // 6 passes
const DRILL = mainDrill(DH) as DrillItemView;
const UPPER = prescriptionView("STRENGTH_UPPER");

const phase = () => screen.getByRole("status").getAttribute("data-phase");
const completeButton = () => screen.getByRole("button", { name: "Terminer la séance" });
const passText = (k: number) => within(document.querySelector(`[data-pass="${k}"]`) as HTMLElement).getByTestId("pass-result").textContent;
const passButton = (verb: "Enregistrer" | "Modifier", k: number) => screen.getByRole("button", { name: `${verb} le passage ${k}` });

async function startSession() {
  await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
  await waitFor(() => expect(phase()).toBe("active"));
}
async function recordPass(k: number, answer?: "Oui" | "Non" | "Non évalué") {
  await userEvent.click(passButton("Enregistrer", k));
  if (answer) await userEvent.click(screen.getByRole("radio", { name: answer }));
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer le passage" }));
  await waitFor(() => expect(passText(k)).toMatch(/^Enregistré/));
}
async function seedPasses(b: ReturnType<typeof fakeBackend>, p: FinalPrescriptionV2View, ordinals: number[]) {
  const drill = mainDrill(p)!;
  const executionId = b.executions.at(-1)!.id;
  const r = await b.post({
    events: [],
    sets: ordinals.map((k) => ({ id: `cccccccc-0000-4000-8000-${String(k).padStart(12, "0")}`, execution_id: executionId, prescription_item_id: drill.prescriptionItemId, set_number: k, done: true as const, measure_type: "pass" as const, measure_value: null, success: null, supersedes_id: null, occurred_at: "2026-10-09T17:30:00Z" })),
  });
  if (!r.ok) throw new Error(r.error.code);
}
/** Seeded rows are read on the next load: pause / resume reloads the confirmed state. */
async function reloadViaPause() {
  await userEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
  await userEvent.click(await screen.findByRole("button", { name: "Reprendre" }));
  await waitFor(() => expect(phase()).toBe("active"));
}

describe("Guided DH session — rendering (UX-11C.3)", () => {
  it("instruction blocks stay read only; the main drill shows cue, criterion (once), vigilances and one slot per planned pass; the word « série » never appears", async () => {
    const b = fakeBackend({ prescription: DH });
    const { container } = render(<Harness deps={b.deps} />);
    await startSession();
    for (const role of ["brief", "warm_up", "application", "cool_down"]) {
      const block = document.querySelector(`[data-block-role="${role}"]`) as HTMLElement;
      expect(block).not.toBeNull();
      expect(within(block).queryByRole("button")).toBeNull();
    }
    const card = document.querySelector(`[data-item-id="${DRILL.prescriptionItemId}"]`) as HTMLElement;
    expect(within(card).getByRole("heading", { name: DRILL.name })).toBeInTheDocument();
    expect(card.textContent).toContain(`Consigne : ${DRILL.cue}`);
    expect(screen.getAllByTestId("success-criterion")).toHaveLength(1);
    expect(screen.getByTestId("success-criterion")).toHaveTextContent(`Critère de réussite : ${DRILL.successCriterion}`);
    expect(card.textContent).toContain("Prévu : 6 passages");
    expect(screen.getByTestId("dh-progress")).toHaveTextContent("0 / 6 passages enregistrés");
    expect(within(screen.getByRole("list", { name: `Passages — ${DRILL.name}` })).getAllByRole("listitem").map((li) => li.querySelector("p")!.textContent)).toEqual(
      ["Passage 1", "Passage 2", "Passage 3", "Passage 4", "Passage 5", "Passage 6"]
    );
    expect(within(document.querySelector('[data-pass="1"]') as HTMLElement).getByText(DH_COPY.current)).toBeInTheDocument();
    expect(b.executions[0]!.exercise_set_results).toEqual([]); // no empty row is pre-created
    await userEvent.click(passButton("Enregistrer", 1));
    expect(container.textContent).not.toMatch(/s[ée]rie/i);
  });

  it.each([4, 6, 8])("%i planned passes → exactly %i slots (count from the final prescription)", async (n) => {
    const b = fakeBackend({ prescription: withPasses(n) });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(within(screen.getByRole("list", { name: `Passages — ${DRILL.name}` })).getAllByRole("listitem")).toHaveLength(n);
    expect(screen.getByTestId("dh-progress")).toHaveTextContent(`0 / ${n} passages enregistrés`);
  });

  it.each([
    ["no main drill", (s: any) => (s.blocks.find((x: any) => x.role === "main").items = [])],
    ["two main drills", (s: any) => {
      const main = s.blocks.find((x: any) => x.role === "main");
      main.items = [main.items[0], { ...main.items[0], prescriptionItemId: "00000000-0000-4000-8000-0000000000ff" }];
    }],
  ])("%s → fail closed: no pass entry, completion disabled", async (_label, mutate) => {
    const b = fakeBackend({ prescription: prescriptionView("DH_TECHNICAL", mutate) });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(document.querySelector('[data-reason="invalid_dh_prescription"]')).toHaveTextContent(DH_COPY.invalid);
    expect(screen.queryAllByRole("button", { name: /le passage/ })).toEqual([]);
    expect(completeButton()).toBeDisabled();
  });
});

describe("Guided DH session — recording passes", () => {
  it("records success true / false / null with the exact pass contract (no load, reps, duration or exercise)", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordPass(1, "Oui");
    await recordPass(2, "Non");
    await recordPass(3); // « Non évalué » by default, saved explicitly
    const execId = b.executions[0]!.id;
    expect(b.state.posts.slice(-3).map((p) => p.sets)).toEqual(
      [1, 2, 3].map((k, i) => [{ id: expect.any(String), execution_id: execId, prescription_item_id: DRILL.prescriptionItemId, set_number: k, done: true, measure_type: "pass", measure_value: null, success: [true, false, null][i], supersedes_id: null, occurred_at: "2026-10-09T17:00:00Z" }])
    );
    expect(passText(1)).toBe("Enregistré · Critère atteint : Oui");
    expect(passText(2)).toBe("Enregistré · Critère atteint : Non");
    expect(passText(3)).toBe("Enregistré · Critère atteint : Non évalué");
    expect(screen.getByTestId("dh-progress")).toHaveTextContent("3 / 6 passages enregistrés");
    // The order is highlighted, never enforced.
    await recordPass(5, "Oui");
    expect(passText(4)).toBe(DH_COPY.noResult);
  });

  it("the answer is a keyboard-usable radio group with a clear label; the entry takes the focus", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(passButton("Enregistrer", 1));
    const group = screen.getByRole("group", { name: "Passage 1 — Critère atteint ?" });
    expect(within(group).getByRole("radio", { name: "Non évalué" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(within(group).getByRole("radio", { name: "Non" })).toBeChecked();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("network failure: the pass stays unconfirmed; retry re-sends the SAME id → one row; a double click sends once", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    b.state.networkFailures = ["landed"];
    await userEvent.click(passButton("Enregistrer", 1));
    await userEvent.click(screen.getByRole("radio", { name: "Oui" }));
    const save = screen.getByRole("button", { name: "Enregistrer le passage" });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(passText(1)).toBe(DH_COPY.noResult);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(passText(1)).toBe("Enregistré · Critère atteint : Oui"));
    const [first, second] = b.state.posts.slice(-2);
    expect(second).toEqual(first);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("two tabs: the second original for the same pass is refused (result_slot_exists) and that tab reloads the confirmed answer", async () => {
    const b = fakeBackend({ prescription: DH });
    const tabA = render(<Harness deps={b.deps} />);
    await userEvent.click(await within(tabA.container).findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(within(tabA.container).getByRole("status")).toHaveAttribute("data-phase", "active"));
    const tabB = render(<Harness deps={b.deps} />);
    await waitFor(() => expect(within(tabB.container).getByRole("status")).toHaveAttribute("data-phase", "active"));
    const save = async (tab: typeof tabA, answer: string) => {
      await userEvent.click(within(tab.container).getByRole("button", { name: "Enregistrer le passage 1" }));
      await userEvent.click(within(tab.container).getByRole("radio", { name: answer }));
      await userEvent.click(within(tab.container).getByRole("button", { name: "Enregistrer le passage" }));
    };
    await save(tabA, "Oui");
    await save(tabB, "Non");
    await waitFor(() => expect(within(tabB.container).getByRole("alert")).toHaveAttribute("data-code", "result_slot_exists"));
    expect(within(tabB.container).getAllByTestId("pass-result")[0]).toHaveTextContent("Enregistré · Critère atteint : Oui");
    expect(b.executions[0]!.exercise_set_results.map((r) => r.success)).toEqual([true]);
  });

  it("correction: « Modifier » opens the recorded answer and appends one superseding row; never a correction of a correction", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordPass(2, "Non");
    const original = b.executions[0]!.exercise_set_results[0]!;
    await userEvent.click(passButton("Modifier", 2));
    expect(screen.getByRole("radio", { name: "Non" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Non" })).toHaveFocus();
    await userEvent.click(screen.getByRole("radio", { name: "Oui" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(passText(2)).toBe(`Enregistré · Critère atteint : Oui · ${DH_COPY.corrected}`));
    const rows = b.executions[0]!.exercise_set_results;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(original);
    expect(rows[1]).toMatchObject({ supersedes_id: original.id, set_number: 2, success: true, measure_type: "pass", measure_value: null });
    expect(screen.queryByRole("button", { name: "Modifier le passage 2" })).toBeNull();
    expect(screen.getByText(DH_COPY.correctedOnce)).toBeInTheDocument();
  });

  it("refresh: same execution, the 2 active results (correction visible), progress 2/N, no duplicate", async () => {
    const b = fakeBackend({ prescription: DH });
    const first = render(<Harness deps={b.deps} />);
    await startSession();
    await recordPass(1, "Oui");
    await recordPass(2, "Non");
    await userEvent.click(passButton("Modifier", 2));
    await userEvent.click(screen.getByRole("radio", { name: "Non évalué" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    await waitFor(() => expect(passText(2)).toMatch(/corrigé$/));
    first.unmount();

    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.executions).toHaveLength(1);
    expect(passText(1)).toBe("Enregistré · Critère atteint : Oui");
    expect(passText(2)).toBe(`Enregistré · Critère atteint : Non évalué · ${DH_COPY.corrected}`);
    expect(screen.getByTestId("dh-progress")).toHaveTextContent("2 / 6 passages enregistrés");
    expect(within(document.querySelector('[data-pass="3"]') as HTMLElement).getByText(DH_COPY.current)).toBeInTheDocument();
    expect(b.executions[0]!.exercise_set_results).toHaveLength(3);
  });
});

describe("Guided DH session — completion", () => {
  it("zero pass → completion disabled with the reason; merely opening an entry sends nothing", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveAccessibleDescription(DH_COPY.needOnePass);
    await userEvent.click(passButton("Enregistrer", 1));
    expect(completeButton()).toBeDisabled();
  });

  it("all planned passes recorded (success false / null included) → direct completion; then read only", async () => {
    const b = fakeBackend({ prescription: withPasses(4) });
    render(<Harness deps={b.deps} />);
    await startSession();
    await seedPasses(b, withPasses(4), [1, 2, 3, 4]);
    await reloadViaPause();
    await userEvent.click(completeButton());
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(b.post.mock.calls.at(-1)![0]).toEqual({ events: [expect.objectContaining({ event_type: "completed" })] });
    expect(screen.queryAllByRole("button", { name: /le passage/ })).toEqual([]);
    expect(passText(1)).toBe("Enregistré · Critère atteint : Non évalué");
    expect(screen.queryByRole("button", { name: "Recommencer la séance" })).toBeNull();
  });

  it("partial passes → the DH confirmation (focus on the safe choice, Escape cancels) → completed; missing passes stay without result", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordPass(1, "Non");
    await userEvent.click(completeButton());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(DH_COPY.partialCompletion);
    expect(within(dialog).getByRole("button", { name: "Revenir à la séance" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(phase()).toBe("active");
    await userEvent.click(completeButton());
    await userEvent.click(screen.getByRole("button", { name: "Terminer quand même" }));
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(passText(2)).toBe(DH_COPY.noResult);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("the last pass answered but not saved travels with `completed` in ONE batch; an untouched open entry is never sent", async () => {
    const b = fakeBackend({ prescription: withPasses(4) });
    render(<Harness deps={b.deps} />);
    await startSession();
    await seedPasses(b, withPasses(4), [1, 2, 3]);
    await reloadViaPause();
    await userEvent.click(passButton("Enregistrer", 4));
    // Untouched: not a result → completion asks for confirmation (pass 4 still without result).
    await userEvent.click(completeButton());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("radio", { name: "Oui" }));
    await userEvent.click(completeButton()); // all 4 passes covered → no confirmation
    await waitFor(() => expect(phase()).toBe("completed"));
    const sent = b.state.posts.at(-1)!;
    expect(sent.events.map((e) => e.event_type)).toEqual(["completed"]);
    expect(sent.sets).toEqual([expect.objectContaining({ set_number: 4, success: true, measure_type: "pass" })]);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(4);
  });
});

describe("Guided DH session — abandon and restart", () => {
  it("abandoned: terminal, read only, passes kept; restart creates a NEW execution while the prescription is current", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordPass(1, "Oui");
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    expect(screen.queryAllByRole("button", { name: /le passage/ })).toEqual([]);
    expect(passText(1)).toBe("Enregistré · Critère atteint : Oui");
    await userEvent.click(screen.getByRole("button", { name: "Recommencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.executions).toHaveLength(2);
    expect(b.executions[1]!.exercise_set_results).toEqual([]);
    expect(screen.getByTestId("dh-progress")).toHaveTextContent("0 / 6 passages enregistrés");
  });

  it("restart refused when the prescription is no longer current", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    const restart = await screen.findByRole("button", { name: "Recommencer la séance" });
    b.setCurrent({ prescription: UPPER });
    await userEvent.click(restart);
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "final_prescription_not_current");
    expect(b.executions).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Commencer la séance" })).toBeInTheDocument();
  });

  it("the backend double refuses a pass after completed / abandoned (UX-11B.2.6) even if a client tried", async () => {
    const b = fakeBackend({ prescription: DH });
    render(<Harness deps={b.deps} />);
    await startSession();
    await recordPass(1);
    await userEvent.click(completeButton());
    await userEvent.click(screen.getByRole("button", { name: "Terminer quand même" }));
    await waitFor(() => expect(phase()).toBe("completed"));
    const late = await b.post({ events: [], sets: [{ id: "dddddddd-0000-4000-8000-000000000001", execution_id: b.executions[0]!.id, prescription_item_id: DRILL.prescriptionItemId, set_number: 2, done: true, measure_type: "pass", measure_value: null, success: true, supersedes_id: null, occurred_at: "2026-10-09T18:00:00Z" }] });
    expect(late).toMatchObject({ ok: false, error: { code: "execution_terminal" } });
  });
});
