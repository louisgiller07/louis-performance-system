import { beforeEach, describe, expect, it, vi } from "vitest";
// Real M1 plans (same cross-boundary import pattern as DailyPlanView.enriched.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { keepFinalPrescription } from "../../test/fixtures/finalPrescriptionV2Fixtures";
import { decodeFinalPrescriptionV2 } from "../finalPrescriptionV2/decodeFinalPrescriptionV2";
import { dayGuidanceOf } from "../dailyPlan/dayGuidance";
import type { ExecutionRow } from "./executionState";

const { loadLatestDecisionForDate, loadDecisionById, loadDecisionCurrency, loadFinalPrescriptionV2State, loadDayExecutions, loadExecutionPrescription, loadOpenHealthFlags } = vi.hoisted(() => ({
  loadLatestDecisionForDate: vi.fn(),
  loadDecisionById: vi.fn(),
  loadDecisionCurrency: vi.fn(),
  loadFinalPrescriptionV2State: vi.fn(),
  loadDayExecutions: vi.fn(),
  loadExecutionPrescription: vi.fn(),
  loadOpenHealthFlags: vi.fn(),
}));
vi.mock("../history/historyRepo", () => ({ loadLatestDecisionForDate, loadDecisionById }));
vi.mock("../dailyPlan/decisionCurrencyRepo", () => ({ loadDecisionCurrency }));
vi.mock("../finalPrescriptionV2/finalPrescriptionV2State", () => ({ loadFinalPrescriptionV2State }));
vi.mock("./executionRepo", () => ({ loadDayExecutions, loadExecutionPrescription }));
vi.mock("../healthFlags/openHealthFlagsRepo", () => ({ loadOpenHealthFlags }));

import { loadGuidedSession } from "./guidedSessionLoader";

// SPORT-SAFE-01R (HPM 2026-10-18, A1) — which decision's guidance the guided session carries: the day's current
// decision before the start; the execution's OWN decision (decision_id, append-only row) once started, whatever the
// day's latest decision has become; nothing for a blocked, read-only or unreadable case. A failed read fails the
// screen (never a session shown without the guidance it may need).

const DH = { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 } as const;
const m1 = (checkin: Record<string, unknown>) => buildDailyPlan(baseRawContext({ planned_session: DH as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], checkin: checkin as never }));
const KNEE_4 = m1({ pain: true, pain_intensity: 4, pain_new: false, pain_location_code: "knee_R" });
const KNEE_6 = m1({ pain: true, pain_intensity: 6, pain_new: false, pain_location_code: "knee_R" });
const NEUTRAL = m1({});
const view = (() => {
  const r = decodeFinalPrescriptionV2(keepFinalPrescription("DH_TECHNICAL").record);
  if (!r.ok) throw new Error(r.reason);
  return r.view;
})();
const decisionRow = (id: string, dailyPlan: unknown) => ({ id, finalPrescriptionStatus: "created", isLatestOfDay: true, dailyPlan });
const execution = (events: string[], decisionId?: string | null): ExecutionRow => ({
  id: "e1",
  session_date: "2026-10-09",
  final_prescription_id: view.id,
  ...(decisionId !== undefined ? { decision_id: decisionId } : {}),
  started_at: "2026-10-09T17:00:00Z",
  recorded_at: "2026-10-09T17:00:00Z",
  execution_events: events.map((event_type, i) => ({ event_type, event_seq: i + 1 })),
  exercise_set_results: [],
  session_activity_results: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  loadDayExecutions.mockResolvedValue([]);
  loadDecisionCurrency.mockResolvedValue({ isCurrent: true, staleReason: null });
  loadOpenHealthFlags.mockResolvedValue([]);
  loadFinalPrescriptionV2State.mockResolvedValue({ kind: "created", prescription: view });
  loadExecutionPrescription.mockResolvedValue({ kind: "created", prescription: view });
});

describe("loadGuidedSession — M1's guidance (SPORT-SAFE-01R)", () => {
  it("before the start: the current decision's guidance (knee 4/10)", async () => {
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d1", KNEE_4));
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(s).toMatchObject({ kind: "ready_to_start", guidance: dayGuidanceOf(KNEE_4) });
  });

  it("before the start, no signal: no guidance key at all", async () => {
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d1", NEUTRAL));
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(s.kind).toBe("ready_to_start");
    expect(s).not.toHaveProperty("guidance");
  });

  it("started: the execution's own decision (frozen), not the day's newer one", async () => {
    loadDayExecutions.mockResolvedValue([execution(["started"], "d-exec")]);
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d-new", NEUTRAL));
    loadDecisionById.mockResolvedValue(decisionRow("d-exec", KNEE_4));
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(loadDecisionById).toHaveBeenCalledWith("a1", "d-exec");
    expect(s).toMatchObject({ kind: "execution", phase: "active", guidance: dayGuidanceOf(KNEE_4) });
  });

  it("started from the day's latest decision (the usual case): its guidance, without reading that decision a second time", async () => {
    loadDayExecutions.mockResolvedValue([execution(["started"], "d1")]);
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d1", KNEE_4));
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(s).toMatchObject({ kind: "execution", phase: "active", guidance: dayGuidanceOf(KNEE_4) });
    expect(loadDecisionById).not.toHaveBeenCalled();
  });

  it("started then suspended (knee 6/10, A6 REST): the health block, no guidance, the decision not even read", async () => {
    loadDayExecutions.mockResolvedValue([execution(["started"], "d-exec")]);
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d-new", KNEE_6));
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(s).toMatchObject({ kind: "execution", healthBlock: "health_suspended" });
    expect(s).not.toHaveProperty("guidance");
    expect(loadDecisionById).not.toHaveBeenCalled();
  });

  it("completed (read only): no guidance", async () => {
    loadDayExecutions.mockResolvedValue([execution(["started", "completed"], "d-exec")]);
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(s).toMatchObject({ kind: "execution", phase: "completed" });
    expect(s).not.toHaveProperty("guidance");
    expect(loadDecisionById).not.toHaveBeenCalled();
  });

  it.each([
    ["no decision id on the execution", undefined, null],
    ["a decision this athlete cannot read", "d-exec", null],
    ["a decision row that is not a valid daily plan", "d-exec", decisionRow("d-exec", { decision: "KEEP" })],
  ] as const)("started, %s: no guidance (never a text of the browser's own)", async (_, decisionId, row) => {
    loadDayExecutions.mockResolvedValue([execution(["started"], decisionId)]);
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d-new", NEUTRAL));
    loadDecisionById.mockResolvedValue(row);
    const s = await loadGuidedSession("a1", "2026-10-09");
    expect(s).toMatchObject({ kind: "execution", phase: "active" });
    expect(s).not.toHaveProperty("guidance");
  });

  it("started, the decision read fails: the screen fails (never the session without its guidance)", async () => {
    loadDayExecutions.mockResolvedValue([execution(["started"], "d-exec")]);
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d-new", NEUTRAL));
    loadDecisionById.mockRejectedValue(new Error("network"));
    await expect(loadGuidedSession("a1", "2026-10-09")).rejects.toThrow("network");
  });
});

describe("loadGuidedSession — a blocked day's reason (SPORT-SAFE-01R.2)", () => {
  it("blocked modify_not_supported → unavailable `blocked` with its reason, for the precise message", async () => {
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d1", NEUTRAL));
    loadFinalPrescriptionV2State.mockResolvedValue({ kind: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 } });
    expect(await loadGuidedSession("a1", "2026-10-09")).toEqual({ kind: "unavailable", reason: "blocked", blockedReason: "modify_not_supported" });
  });

  it("blocked without a detail reason → unavailable `blocked`, nothing more (unchanged)", async () => {
    loadLatestDecisionForDate.mockResolvedValue(decisionRow("d1", NEUTRAL));
    loadFinalPrescriptionV2State.mockResolvedValue({ kind: "blocked", code: "final_prescription_no_lineage", detail: null });
    expect(await loadGuidedSession("a1", "2026-10-09")).toEqual({ kind: "unavailable", reason: "blocked" });
  });
});
