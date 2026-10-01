import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GuidedSessionView } from "./GuidedSessionView";
import { useGuidedSession, type GuidedSessionDeps } from "./useGuidedSession";
import { selectDayExecution, isTerminal, type ExecutionRow } from "./executionState";
import type { GuidedSessionSnapshot } from "./guidedSessionLoader";
import type { SessionExecutionBatch, SessionExecutionResult } from "./sessionExecutionClient";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";
import { UNAVAILABLE_MESSAGES, UNSUPPORTED_SESSION_MESSAGE } from "./guidedSessionCopy";

// UX-11C.1 — shell + lifecycle against an in-memory backend that reproduces
// the record_session_execution rules the shell relies on: idempotent ids,
// one open execution per day, current final prescription at start only.

const view = (kind: "STRENGTH_LOWER" | "DH_TECHNICAL") => {
  const r = decodeFinalPrescriptionV2(keepFinalPrescription(kind).record);
  if (!r.ok) throw new Error(r.reason);
  return r.view;
};
const FORCE = view("STRENGTH_LOWER");
const DH = view("DH_TECHNICAL");

function fakeBackend(current: { prescription: typeof FORCE | null; unavailable?: GuidedSessionSnapshot & { kind: "unavailable" } }) {
  const executions: ExecutionRow[] = [];
  let seq = 0;
  const events = new Map<string, string>();
  const state = { current, networkFailures: 0, posts: [] as SessionExecutionBatch[] };
  const prescriptions = new Map([[FORCE.id, FORCE], [DH.id, DH]]);

  const post = vi.fn(async (batch: SessionExecutionBatch): Promise<SessionExecutionResult> => {
    state.posts.push(batch);
    if (state.networkFailures > 0) {
      state.networkFailures -= 1;
      // The request may or may not have reached the server: here it did (worst case for duplicates).
      apply(batch);
      return { ok: false, error: { code: "network_error", status: null, retryable: true } };
    }
    return apply(batch);
  });
  function apply(batch: SessionExecutionBatch): SessionExecutionResult {
    const inserted: Record<string, string[]> = { executions: [], events: [] };
    const unchanged: Record<string, string[]> = { executions: [], events: [] };
    if (batch.execution) {
      const existing = executions.find((e) => e.id === batch.execution!.id);
      if (existing) unchanged.executions!.push(existing.id);
      else {
        if (batch.execution.final_prescription_id !== state.current.prescription?.id) return { ok: false, error: { code: "final_prescription_not_current", status: 409, retryable: false } };
        const open = executions.some((e) => !isTerminal(selectDayExecution([e])!.phase));
        if (open) return { ok: false, error: { code: "active_execution_exists", status: 409, retryable: false } };
        executions.push({ id: batch.execution.id, session_date: "2026-10-09", final_prescription_id: batch.execution.final_prescription_id, started_at: batch.execution.started_at, recorded_at: `2026-10-09T17:00:0${executions.length}Z`, execution_events: [] });
        inserted.executions!.push(batch.execution.id);
      }
    }
    for (const ev of batch.events) {
      if (events.has(ev.id)) {
        unchanged.events!.push(ev.id);
        continue;
      }
      events.set(ev.id, ev.event_type);
      executions.find((e) => e.id === ev.execution_id)!.execution_events.push({ event_type: ev.event_type, event_seq: ++seq });
      inserted.events!.push(ev.id);
    }
    return { ok: true, value: { inserted, unchanged } };
  }
  const load = vi.fn(async (): Promise<GuidedSessionSnapshot> => {
    const day = selectDayExecution(executions);
    if (day && !isTerminal(day.phase)) {
      const p = prescriptions.get(day.execution.final_prescription_id!);
      return { kind: "execution", ...day, prescription: p ? { kind: "created", prescription: p } : { kind: "unsupported_schema_or_catalog", reason: "old catalogue" } };
    }
    if (state.current.unavailable) return state.current.unavailable;
    const cur = state.current.prescription!;
    if (day && day.execution.final_prescription_id === cur.id) return { kind: "execution", ...day, prescription: { kind: "created", prescription: cur } };
    return { kind: "ready_to_start", finalPrescriptionId: cur.id, prescription: cur };
  });
  let n = 0;
  const deps: GuidedSessionDeps = { load, post, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, now: () => "2026-10-09T17:00:00Z" };
  return { deps, state, executions, post, load, prescriptions };
}

function Harness({ deps }: { deps: GuidedSessionDeps }) {
  const s = useGuidedSession("a", "2026-10-09", deps);
  return (
    <MemoryRouter>
      <GuidedSessionView
        load={s.load}
        busy={s.busy}
        actionError={s.actionError}
        onStart={(id) => void s.start(id)}
        onPause={(id) => void s.pause(id)}
        onResume={(id) => void s.resume(id)}
        onAbandon={(id) => void s.abandon(id)}
        onRetry={() => void s.retry()}
        onReload={() => void s.reload()}
      />
    </MemoryRouter>
  );
}

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

  it("network error → last confirmed state kept, retry re-sends the SAME ids → no second execution", async () => {
    const b = fakeBackend({ prescription: FORCE });
    b.state.networkFailures = 1;
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

    b.state.current = { prescription: DH }; // D2 becomes current
    render(<Harness deps={b.deps} />);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(screen.getByText("Goblet squat")).toBeInTheDocument(); // E1's Force prescription, never D2's DH
    expect(screen.queryByText(`${DH.blocks.find((x) => x.role === "main")!.items.length} passages`)).toBeNull();
  });

  it("stale start: the prescription shown is no longer current → final_prescription_not_current, nothing created, Daily state reloaded", async () => {
    const b = fakeBackend({ prescription: FORCE });
    render(<Harness deps={b.deps} />);
    const start = await screen.findByRole("button", { name: "Commencer la séance" });
    b.state.current = { prescription: DH }; // the daily decision changed after the page loaded
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
    b.executions.push({ id: "e-old", session_date: "2026-10-09", final_prescription_id: FORCE.id, started_at: "x", recorded_at: "2026-10-09T16:00:00Z", execution_events: [{ event_type: "started", event_seq: 0 }] });
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
