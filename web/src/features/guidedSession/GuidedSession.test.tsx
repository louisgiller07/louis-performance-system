import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UNAVAILABLE_MESSAGES, UNSUPPORTED_SESSION_MESSAGE } from "./guidedSessionCopy";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";

// UX-11C.1 — shell + lifecycle against an in-memory backend that reproduces
// the record_session_execution rules the shell relies on: idempotent ids,
// one open execution per day, current final prescription at start only.

const FORCE = prescriptionView("STRENGTH_LOWER");
const DH = prescriptionView("DH_TECHNICAL");

const phase = () => screen.getByRole("status").getAttribute("data-phase");

describe("Guided session shell (UX-11C.1)", () => {
  it("created → Start visible; Start creates E1 with its started event on the CURRENT final prescription", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.post).toHaveBeenCalledTimes(1);
    const batch = b.post.mock.calls[0]![0];
    expect(batch.execution).toMatchObject({ final_prescription_id: FORCE.id, session_date: "2026-10-09" });
    expect(batch.events).toEqual([{ id: expect.any(String), execution_id: batch.execution!.id, event_type: "started", occurred_at: "2026-10-09T17:00:00Z" }]);
    expect(b.executions).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Commencer la séance" })).toBeNull();
    // Completion never forced: disabled until a session module can complete.
    expect(screen.getByRole("button", { name: "Terminer la séance" })).toBeDisabled();
  });

  it("double click on Start → one request, one execution", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    const start = await screen.findByRole("button", { name: "Commencer la séance" });
    await act(async () => {
      start.click();
      start.click();
    });
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.post).toHaveBeenCalledTimes(1);
    expect(b.executions).toHaveLength(1);
  });

  it.each([
    ["pause", "Mettre en pause", "paused", ["started", "paused"]],
    ["abandon", null, "abandoned", ["started", "abandoned"]],
  ] as const)("UX-11C.5 — %s after a network error: retry re-sends the SAME event id → one event", async (_label, button, expectedPhase, events) => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    b.state.networkFailures = ["landed"];
    if (button) await userEvent.click(screen.getByRole("button", { name: button }));
    else {
      await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
      await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    }
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(phase()).toBe("active"); // the last CONFIRMED state, never optimistic
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(phase()).toBe(expectedPhase));
    const [first, second] = b.state.posts.slice(-2);
    expect(second).toEqual(first);
    expect(b.executions[0]!.execution_events.map((e) => e.event_type)).toEqual(events);
  });

  it("UX-11C.5 — resume after a network error: retry re-sends the SAME event id → one event", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await userEvent.click(await screen.findByRole("button", { name: "Mettre en pause" }));
    await waitFor(() => expect(phase()).toBe("paused"));
    b.state.networkFailures = ["landed"];
    await userEvent.click(screen.getByRole("button", { name: "Reprendre" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(phase()).toBe("paused");
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.state.posts.at(-1)).toEqual(b.state.posts.at(-2));
    expect(b.executions[0]!.execution_events.map((e) => e.event_type)).toEqual(["started", "paused", "resumed"]);
  });

  it("network error → last confirmed state kept, retry re-sends the SAME ids → no second execution", async () => {
    const b = fakeBackend({ prescription: FORCE });
    b.state.networkFailures = ["landed"];
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "network_error");
    expect(phase()).toBe("not_started");
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.state.posts[1]).toEqual(b.state.posts[0]);
    expect(b.executions).toHaveLength(1);
  });

  it("refresh after Start finds E1 (no Start, no second started); pause → refresh → paused; resume → active", async () => {
    const b = fakeBackend({ prescription: FORCE });
    const first = render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    first.unmount();

    const second = render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(screen.queryByRole("button", { name: "Commencer la séance" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
    await waitFor(() => expect(phase()).toBe("paused"));
    second.unmount();

    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("paused"));
    expect(screen.getByRole("status")).toHaveTextContent("État : en pause");
    await userEvent.click(screen.getByRole("button", { name: "Reprendre" }));
    await waitFor(() => expect(phase()).toBe("active"));
    expect(b.executions).toHaveLength(1);
    expect(b.executions[0]!.execution_events.map((e) => e.event_type)).toEqual(["started", "paused", "resumed"]);
  });

  it("abandon: confirmation takes the focus, cancel keeps the session, confirm makes it terminal (no more lifecycle action)", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));

    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Continuer la séance" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(phase()).toBe("active");

    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    for (const name of ["Mettre en pause", "Reprendre", "Arrêter la séance", "Terminer la séance", "Commencer la séance"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByRole("link", { name: "Retour à Aujourd'hui" })).toBeInTheDocument();
    expect(b.executions[0]!.execution_events.at(-1)!.event_type).toBe("abandoned");
  });

  it("a newer daily decision during E1: E1 keeps showing ITS prescription; a NEW start from a stale prescription is refused and the state reloaded", async () => {
    const b = fakeBackend({ prescription: FORCE });
    const first = render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    first.unmount();

    b.setCurrent({ prescription: DH }); // D2 becomes current
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(screen.getByText("Goblet squat")).toBeInTheDocument(); // E1's Force prescription, never D2's DH
    expect(screen.queryByText(`${DH.blocks.find((x) => x.role === "main")!.items.length} passages`)).toBeNull();
  });

  it("stale start: the prescription shown is no longer current → final_prescription_not_current, nothing created, Daily state reloaded", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    const start = await screen.findByRole("button", { name: "Commencer la séance" });
    b.setCurrent({ prescription: DH }); // the daily decision changed after the page loaded
    const loadsBefore = b.load.mock.calls.length;
    await userEvent.click(start);
    expect(await screen.findByRole("alert")).toHaveAttribute("data-code", "final_prescription_not_current");
    expect(b.executions).toHaveLength(0);
    expect(b.load.mock.calls.length).toBeGreaterThan(loadsBefore);
    // The reloaded state is the new current prescription (no fallback to the old one).
    expect(screen.queryByText("Goblet squat")).toBeNull();
  });

  it.each(["rest", "blocked", "not_v2", "missing_prescription", "stale_decision"] as const)("unavailable (%s): explanation, no Start, nothing posted", async (reason) => {
    const b = fakeBackend({ prescription: null, unavailable: { kind: "unavailable", reason } });
    render(<Harness deps={b.deps} />);
    expect(await screen.findByText(UNAVAILABLE_MESSAGES[reason])).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commencer la séance" })).toBeNull();
    expect(b.post).not.toHaveBeenCalled();
  });

  it("unsupported catalogue on an existing execution: no partial rendering, explicit message, the execution is kept", async () => {
    const b = fakeBackend({ prescription: FORCE });
    b.prescriptions.delete(FORCE.id); // the linked prescription is not decodable by this version
    b.executions.push({ id: "e-old", session_date: "2026-10-09", final_prescription_id: FORCE.id, started_at: "x", recorded_at: "2026-10-09T16:00:00Z", execution_events: [{ event_type: "started", event_seq: 0 }], exercise_set_results: [], session_activity_results: [] });
    render(<Harness deps={b.deps} />);
    expect(await screen.findByText(UNSUPPORTED_SESSION_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText("Goblet squat")).toBeNull();
    expect(screen.getByRole("button", { name: "Mettre en pause" })).toBeInTheDocument();
    expect(b.post).not.toHaveBeenCalled();
  });

  it("mobile-oriented actions: full-width, 48 px minimum height, state written in words", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    const start = await screen.findByRole("button", { name: "Commencer la séance" });
    expect(start.className).toMatch(/\bw-full\b/);
    expect(start.className).toMatch(/\bmin-h-12\b/);
    expect(screen.getByRole("status")).toHaveTextContent("État : pas encore commencée");
  });
});
