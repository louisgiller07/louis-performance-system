import { beforeEach, describe, expect, it, vi } from "vitest";
import { phaseOf, selectDayExecution, type ExecutionRow } from "./executionState";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";

const { loadLatestDecisionForDate, loadDecisionCurrency, loadFinalPrescriptionV2State, loadDayExecutions, loadExecutionPrescription } = vi.hoisted(() => ({
  loadLatestDecisionForDate: vi.fn(),
  loadDecisionCurrency: vi.fn(),
  loadFinalPrescriptionV2State: vi.fn(),
  loadDayExecutions: vi.fn(),
  loadExecutionPrescription: vi.fn(),
}));
vi.mock("../history/historyRepo", () => ({ loadLatestDecisionForDate }));
vi.mock("../dailyPlan/decisionCurrencyRepo", () => ({ loadDecisionCurrency }));
vi.mock("../finalPrescriptionV2/finalPrescriptionV2State", () => ({ loadFinalPrescriptionV2State }));
vi.mock("./executionRepo", () => ({ loadDayExecutions, loadExecutionPrescription }));

import { loadGuidedSession } from "./guidedSessionLoader";

const created = (kind: "STRENGTH_LOWER" | "DH_TECHNICAL" | "AEROBIC_BASE") => {
  const r = decodeFinalPrescriptionV2(keepFinalPrescription(kind).record);
  if (!r.ok) throw new Error(r.reason);
  return { kind: "created" as const, prescription: r.view };
};
const execution = (id: string, fp: string | null, events: string[], recorded = "2026-10-09T17:00:00Z"): ExecutionRow => ({
  id,
  session_date: "2026-10-09",
  final_prescription_id: fp,
  started_at: recorded,
  recorded_at: recorded,
  execution_events: events.map((event_type, i) => ({ event_type, event_seq: i + 1 })),
  exercise_set_results: [],
  session_activity_results: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  loadDayExecutions.mockResolvedValue([]);
  loadLatestDecisionForDate.mockResolvedValue({ id: "d1", finalPrescriptionStatus: "created", isLatestOfDay: true });
  loadDecisionCurrency.mockResolvedValue({ isCurrent: true, staleReason: null });
});

describe("executionState — a projection of the ledger", () => {
  it.each([
    [["started"], "active"],
    [["started", "paused"], "paused"],
    [["started", "paused", "resumed"], "active"],
    [["started", "completed"], "completed"],
    [["started", "paused", "abandoned"], "abandoned"],
  ])("%j → %s", (events, phase) => {
    expect(phaseOf(execution("e", "f", events as string[]))).toBe(phase);
  });

  it("the open execution of the day wins; otherwise the latest terminal one", () => {
    const old = execution("e1", "f1", ["started", "abandoned"], "2026-10-09T16:00:00Z");
    const open = execution("e2", "f1", ["started"], "2026-10-09T17:00:00Z");
    expect(selectDayExecution([old, open])?.execution.id).toBe("e2");
    expect(selectDayExecution([old])?.phase).toBe("abandoned");
    expect(selectDayExecution([])).toBeNull();
  });
});

describe("loadGuidedSession", () => {
  it("created + current → ready_to_start on the current final prescription (never a planned prescription)", async () => {
    const force = created("STRENGTH_LOWER");
    loadFinalPrescriptionV2State.mockResolvedValue(force);
    expect(await loadGuidedSession("a", "2026-10-09")).toEqual({ kind: "ready_to_start", finalPrescriptionId: force.prescription.id, prescription: force.prescription });
  });

  it.each([
    [{ kind: "not_required" }, "rest"],
    [{ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: null }, "blocked"],
    [{ kind: "final_prescription_missing" }, "missing_prescription"],
    [{ kind: "unsupported_schema_or_catalog", reason: "v2.6" }, "unsupported"],
    [undefined, "not_v2"],
  ])("%j → unavailable %s (no start)", async (state, reason) => {
    loadFinalPrescriptionV2State.mockResolvedValue(state);
    expect(await loadGuidedSession("a", "2026-10-09")).toEqual({ kind: "unavailable", reason });
  });

  it("no decision / stale decision → unavailable", async () => {
    loadLatestDecisionForDate.mockResolvedValueOnce(null);
    expect(await loadGuidedSession("a", "2026-10-09")).toEqual({ kind: "unavailable", reason: "no_decision" });
    loadDecisionCurrency.mockResolvedValueOnce({ isCurrent: false, staleReason: "checkin_changed" });
    expect(await loadGuidedSession("a", "2026-10-09")).toEqual({ kind: "unavailable", reason: "stale_decision" });
  });

  it("an open execution E1 is resumed with ITS OWN final prescription, even when a newer decision now prescribes something else", async () => {
    const force = created("STRENGTH_LOWER");
    loadDayExecutions.mockResolvedValue([execution("e1", force.prescription.id, ["started", "paused"])]);
    loadExecutionPrescription.mockResolvedValue(force);
    loadFinalPrescriptionV2State.mockResolvedValue(created("DH_TECHNICAL")); // the newer daily decision
    const snapshot = await loadGuidedSession("a", "2026-10-09");
    expect(snapshot).toMatchObject({ kind: "execution", phase: "paused", execution: { id: "e1" }, prescription: force });
    expect(loadExecutionPrescription).toHaveBeenCalledWith(force.prescription.id);
    expect(loadLatestDecisionForDate).not.toHaveBeenCalled();
  });

  it("an open execution on an unsupported catalogue stays resumable (never destroyed), rendered as unsupported", async () => {
    loadDayExecutions.mockResolvedValue([execution("e1", "f-old", ["started"])]);
    loadExecutionPrescription.mockResolvedValue({ kind: "unsupported_schema_or_catalog", reason: "catalogue session-model-v2.4" });
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "active", prescription: { kind: "unsupported_schema_or_catalog" } });
  });

  it("a terminal execution of the current prescription is shown read only (no new start offered)", async () => {
    const force = created("STRENGTH_LOWER");
    loadDayExecutions.mockResolvedValue([execution("e1", force.prescription.id, ["started", "abandoned"])]);
    loadFinalPrescriptionV2State.mockResolvedValue(force);
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "abandoned" });
  });

  it("UX-11C.2 — an abandoned attempt of the CURRENT prescription is restartable (new execution); a completed one is not", async () => {
    const force = created("STRENGTH_LOWER");
    loadFinalPrescriptionV2State.mockResolvedValue(force);
    loadDayExecutions.mockResolvedValue([execution("e1", force.prescription.id, ["started", "abandoned"])]);
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "abandoned", restartFinalPrescriptionId: force.prescription.id });
    loadDayExecutions.mockResolvedValue([execution("e1", force.prescription.id, ["started", "completed"])]);
    expect(await loadGuidedSession("a", "2026-10-09")).not.toHaveProperty("restartFinalPrescriptionId");
    loadDayExecutions.mockResolvedValue([
      execution("e1", force.prescription.id, ["started", "completed"], "2026-10-09T16:00:00Z"),
      execution("e2", force.prescription.id, ["started", "abandoned"], "2026-10-09T17:00:00Z"),
    ]);
    expect(await loadGuidedSession("a", "2026-10-09")).not.toHaveProperty("restartFinalPrescriptionId");
  });

  it("UX-11C.2 — an abandoned attempt of a prescription that is no longer current is not restartable: the current one is offered", async () => {
    const dh = created("DH_TECHNICAL");
    loadFinalPrescriptionV2State.mockResolvedValue(dh);
    loadDayExecutions.mockResolvedValue([execution("e1", "f-old", ["started", "abandoned"])]);
    expect(await loadGuidedSession("a", "2026-10-09")).toEqual({ kind: "ready_to_start", finalPrescriptionId: dh.prescription.id, prescription: dh.prescription });
  });
});

// UX-11R.9 (R9-UI-01) — a completed execution of the day stays authoritative and readable,
// whatever the day's current decision has become.
describe("loadGuidedSession — UX-11R.9 a completed execution of the day wins", () => {
  it("Test 1 — completed on fp-old + a newer current decision on fp-new → the completed execution (fp-old), never ready_to_start on fp-new", async () => {
    const old = created("DH_TECHNICAL");
    const fresh = created("STRENGTH_LOWER");
    loadDayExecutions.mockResolvedValue([execution("e1", old.prescription.id, ["started", "paused", "resumed", "completed"])]);
    loadExecutionPrescription.mockResolvedValue(old);
    loadFinalPrescriptionV2State.mockResolvedValue(fresh);
    const snapshot = await loadGuidedSession("a", "2026-10-09");
    expect(snapshot).toMatchObject({ kind: "execution", phase: "completed", execution: { id: "e1" }, prescription: old });
    expect(snapshot).not.toHaveProperty("restartFinalPrescriptionId");
    expect(loadExecutionPrescription).toHaveBeenCalledWith(old.prescription.id);
    // Decided before (and independently of) the day's current decision.
    expect(loadLatestDecisionForDate).not.toHaveBeenCalled();
    expect(loadFinalPrescriptionV2State).not.toHaveBeenCalled();
  });

  it("Test 2 — completed + the latest decision is stale → the completed execution stays readable", async () => {
    const dh = created("DH_TECHNICAL");
    loadDayExecutions.mockResolvedValue([execution("e1", dh.prescription.id, ["started", "completed"])]);
    loadExecutionPrescription.mockResolvedValue(dh);
    loadDecisionCurrency.mockResolvedValue({ isCurrent: false, staleReason: "checkin_changed" });
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "completed", prescription: dh });
  });

  it("Test 3 — completed + the latest decision is REST (not_required) or blocked → the completed execution stays readable", async () => {
    const dh = created("DH_TECHNICAL");
    loadDayExecutions.mockResolvedValue([execution("e1", dh.prescription.id, ["started", "completed"])]);
    loadExecutionPrescription.mockResolvedValue(dh);
    for (const state of [{ kind: "not_required" }, { kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: null }]) {
      loadFinalPrescriptionV2State.mockResolvedValue(state);
      expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "completed", prescription: dh });
    }
  });

  it("Test 4 — abandoned only, on the prescription that is still current → restart stays available (UX-11C.2 unchanged)", async () => {
    const dh = created("DH_TECHNICAL");
    loadFinalPrescriptionV2State.mockResolvedValue(dh);
    loadDayExecutions.mockResolvedValue([execution("e1", dh.prescription.id, ["started", "paused", "abandoned"])]);
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "abandoned", restartFinalPrescriptionId: dh.prescription.id });
  });

  it("Test 5 — abandoned (more recent) + completed (historical) → the completion wins, no restart", async () => {
    const dh = created("DH_TECHNICAL");
    loadFinalPrescriptionV2State.mockResolvedValue(dh);
    loadExecutionPrescription.mockResolvedValue(dh);
    loadDayExecutions.mockResolvedValue([
      execution("e1", dh.prescription.id, ["started", "completed"], "2026-10-09T16:00:00Z"),
      execution("e2", dh.prescription.id, ["started", "abandoned"], "2026-10-09T17:00:00Z"),
    ]);
    const snapshot = await loadGuidedSession("a", "2026-10-09");
    expect(snapshot).toMatchObject({ kind: "execution", phase: "completed", execution: { id: "e1" } });
    expect(snapshot).not.toHaveProperty("restartFinalPrescriptionId");
  });

  it("several completions (historical data only): deterministic — the most recently recorded one", async () => {
    const dh = created("DH_TECHNICAL");
    loadExecutionPrescription.mockResolvedValue(dh);
    loadDayExecutions.mockResolvedValue([
      execution("e1", "fp-a", ["started", "completed"], "2026-10-09T16:00:00Z"),
      execution("e2", "fp-b", ["started", "completed"], "2026-10-09T17:00:00Z"),
    ]);
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "completed", execution: { id: "e2" } });
    expect(loadExecutionPrescription).toHaveBeenCalledWith("fp-b");
  });

  it("Test 6 — an OPEN execution + a new Daily → the open execution wins with its own frozen prescription (non-regression)", async () => {
    const dh = created("DH_TECHNICAL");
    loadDayExecutions.mockResolvedValue([
      execution("e0", "fp-done", ["started", "completed"], "2026-10-09T15:00:00Z"),
      execution("e1", dh.prescription.id, ["started", "paused", "resumed"], "2026-10-09T17:00:00Z"),
    ]);
    loadExecutionPrescription.mockResolvedValue(dh);
    loadFinalPrescriptionV2State.mockResolvedValue(created("STRENGTH_LOWER"));
    expect(await loadGuidedSession("a", "2026-10-09")).toMatchObject({ kind: "execution", phase: "active", execution: { id: "e1" }, prescription: dh });
    expect(loadExecutionPrescription).toHaveBeenCalledWith(dh.prescription.id);
    expect(loadLatestDecisionForDate).not.toHaveBeenCalled();
  });
});
