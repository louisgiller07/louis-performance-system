import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { ACTION_ERROR_MESSAGES, HEALTH_BLOCK_COPY } from "./guidedSessionCopy";
import { healthBlockOf } from "./healthBlock";
import { daySessionEntryKind } from "./daySessionEntry";
import type { ExecutionRow } from "./executionState";
import type { ExerciseItemView } from "../finalPrescriptionV2/finalPrescriptionV2Types";

// P0-3 (HPM 2026-10-13) — /today/session under a health suspension (or a stale day decision), through the real
// shell + hook + Force module against the backend double, which refuses like record_session_execution
// (migration 20261013160000): no resume, no new result, no completion; pause, stop and replays pass.

const LOWER = prescriptionView("STRENGTH_LOWER");
const SQUAT = LOWER.blocks.flatMap((b) => b.items).find((i) => i.kind === "exercise" && i.exerciseId === "goblet_squat") as ExerciseItemView;

const phase = () => document.querySelector("[data-phase]")!.getAttribute("data-phase");
const slotText = (n: number) => within(document.querySelector(`[data-slot="${SQUAT.prescriptionItemId}#${n}"]`) as HTMLElement).getByTestId("slot-result").textContent;

async function startAndRecordOneSet() {
  await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
  await waitFor(() => expect(phase()).toBe("active"));
  await userEvent.click(screen.getByRole("button", { name: `Saisir la série 1 — ${SQUAT.name}` }));
  await userEvent.type(screen.getByLabelText("Répétitions réalisées"), "8");
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer la série" }));
  await waitFor(() => expect(slotText(1)).toMatch(/^Réalisé/));
}

function expectNoTrainingAction() {
  for (const name of ["Mettre en pause", "Reprendre", "Terminer la séance", "Commencer la séance", "Recommencer la séance"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Saisir la série/ })).toBeNull();
}

describe("Guided session — P0-3 health suspension", () => {
  it("started, a set recorded, then suspended: on reload / direct navigation → 'Séance suspendue', results shown read only, only a safe stop; the stop keeps the results", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const first = render(<Harness deps={b.deps} />);
    await startAndRecordOneSet();
    b.state.healthBlock = "health_suspended";
    first.unmount();

    render(<Harness deps={b.deps} />);
    const banner = await screen.findByTestId("guided-session-health-block");
    expect(banner).toHaveAttribute("data-block", "health_suspended");
    expect(banner).toHaveTextContent(HEALTH_BLOCK_COPY.health_suspended.title);
    expect(screen.getByText(`État : ${HEALTH_BLOCK_COPY.health_suspended.state}`)).toBeInTheDocument();
    expect(slotText(1)).toMatch(/^Réalisé/); // results recorded before the suspension stay visible
    expectNoTrainingAction();
    expect(screen.getByRole("link", { name: "Retour à Aujourd'hui" })).toHaveAttribute("href", "/today");

    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    // INT-01 R1 — the stop confirmation never offers to carry on training under a suspension.
    expect(screen.queryByRole("button", { name: "Continuer la séance" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retour" }));
    expect(b.executions[0]!.execution_events.map((e) => e.event_type)).toEqual(["started"]);
    expectNoTrainingAction();
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    expect(b.executions[0]!.execution_events.map((e) => e.event_type)).toEqual(["started", "abandoned"]);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Recommencer la séance" })).toBeNull(); // no restart while suspended
  });

  it("without a suspension the stop confirmation still offers « Continuer la séance »", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startAndRecordOneSet();
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Continuer la séance" }));
    expect(phase()).toBe("active");
  });

  it("the suspension arrives while the screen is open: 'Reprendre' is refused (health_suspended), nothing is written, the screen turns suspended", async () => {
    const b = fakeBackend({ prescription: LOWER });
    render(<Harness deps={b.deps} />);
    await startAndRecordOneSet();
    await userEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
    await waitFor(() => expect(phase()).toBe("paused"));
    b.state.healthBlock = "health_suspended";

    await userEvent.click(screen.getByRole("button", { name: "Reprendre" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-code", "health_suspended");
    expect(alert).toHaveTextContent(ACTION_ERROR_MESSAGES.health_suspended!);
    expect(await screen.findByTestId("guided-session-health-block")).toBeInTheDocument();
    expectNoTrainingAction();
    expect(b.executions[0]!.execution_events.map((e) => e.event_type)).toEqual(["started", "paused"]);
    expect(b.executions[0]!.exercise_set_results).toHaveLength(1);
  });

  it("a stale day decision (check-in changed): 'Analyse du jour à relancer', back to Today, no training action", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const first = render(<Harness deps={b.deps} />);
    await startAndRecordOneSet();
    b.state.healthBlock = "daily_decision_not_current";
    first.unmount();
    render(<Harness deps={b.deps} />);
    expect(await screen.findByTestId("guided-session-health-block")).toHaveAttribute("data-block", "daily_decision_not_current");
    expect(screen.getByText(HEALTH_BLOCK_COPY.daily_decision_not_current.text)).toBeInTheDocument();
    expectNoTrainingAction();
    expect(screen.getByRole("button", { name: "Arrêter la séance" })).toBeInTheDocument();
  });

  it("a session completed before the suspension stays completed and read only (no banner, no new start)", async () => {
    const b = fakeBackend({ prescription: LOWER });
    const first = render(<Harness deps={b.deps} />);
    await startAndRecordOneSet();
    await userEvent.click(screen.getByRole("button", { name: "Terminer la séance" }));
    const confirm = await screen.findByRole("button", { name: "Terminer quand même" }).catch(() => null);
    if (confirm) await userEvent.click(confirm);
    await waitFor(() => expect(phase()).toBe("completed"));
    b.state.healthBlock = "health_suspended";
    first.unmount();
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("completed"));
    expect(screen.queryByTestId("guided-session-health-block")).toBeNull();
    expectNoTrainingAction();
  });
});

describe("P0-3 — pure rules", () => {
  const rule = (layer: string, rule_id: string) => ({ layer: layer as "A", rule_id, detail: "", signals_used: [] });
  const decision = (d: string, rules: ReturnType<typeof rule>[], isCurrent = true) => ({ dailyPlan: { decision: d as "REST", triggered_rules: rules }, isCurrent });

  it.each([
    ["REST A1", { openFlagTypes: [], family: "strength", latestDecision: decision("REST", [rule("A", "A1")]) }, "health_suspended"],
    ["REST A4", { openFlagTypes: [], family: "strength", latestDecision: decision("REST", [rule("A", "A4")]) }, "health_suspended"],
    ["REST A7", { openFlagTypes: [], family: "strength", latestDecision: decision("REST", [rule("A", "A7")]) }, "health_suspended"],
    ["open illness signal, no decision yet", { openFlagTypes: ["illness"], family: "strength", latestDecision: null }, "health_suspended"],
    ["open concussion + DH", { openFlagTypes: ["concussion_suspect"], family: "dh_technical", latestDecision: decision("KEEP", []) }, "health_suspended"],
    ["open concussion + Force (A5 forbids DH only)", { openFlagTypes: ["concussion_suspect"], family: "strength", latestDecision: decision("KEEP", []) }, null],
    ["open 'other' signal", { openFlagTypes: ["other"], family: "strength", latestDecision: decision("KEEP", []) }, null],
    ["ordinary REST (race protocol)", { openFlagTypes: [], family: "dh_technical", latestDecision: decision("REPLACE", [rule("B", "RACE_PROTOCOL_TX")]) }, null],
    ["stale decision", { openFlagTypes: [], family: "strength", latestDecision: decision("KEEP", [], false) }, "daily_decision_not_current"],
    ["stale REST A6 → suspension first", { openFlagTypes: [], family: "strength", latestDecision: decision("REST", [rule("A", "A6")], false) }, "health_suspended"],
  ] as const)("healthBlockOf: %s → %s", (_label, input, expected) => {
    expect(healthBlockOf(input as Parameters<typeof healthBlockOf>[0])).toBe(expected);
  });

  const exec = (events: string[]): ExecutionRow => ({ id: "e", session_date: "2026-10-09", final_prescription_id: "f", started_at: "t", recorded_at: "t", execution_events: events.map((event_type, i) => ({ event_type, event_seq: i + 1 })), exercise_set_results: [], session_activity_results: [] });
  it.each([
    [[["started"]], false, false, "resume"],
    [[["started", "paused"]], false, true, "suspended"],
    [[["started", "completed"]], true, true, "completed"],
    [[["started", "abandoned"]], true, false, "start"],
    [[["started", "abandoned"]], false, false, "none"],
    [[], true, true, "none"],
    [[], true, false, "start"],
  ] as const)("daySessionEntryKind %j created=%s suspended=%s → %s", (events, created, suspended, expected) => {
    expect(daySessionEntryKind({ executions: events.map((e) => exec([...e])), finalPrescriptionCreated: created, healthSuspended: suspended })).toBe(expected);
  });
});
