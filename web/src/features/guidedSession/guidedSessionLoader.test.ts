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
