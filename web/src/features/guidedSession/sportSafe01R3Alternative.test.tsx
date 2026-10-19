import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Real M1 plan and real V2 A10 application (same cross-boundary import pattern as DailyPlanView.enriched.test.tsx).
import { buildDailyPlan } from "../../../../head-coach-engine/src/engine/buildDailyPlan.js";
import { baseRawContext } from "../../../../head-coach-engine/fixtures/louis.js";
import { applyV2TodayTimeConstraint } from "../../../../head-coach-engine/src/supabase/dailyV2/applyV2TodayTimeConstraint.js";
import { fakeBackend, prescriptionView } from "../../test/guidedSessionFakeBackend";
import { GuidedSessionHarness as Harness } from "../../test/GuidedSessionHarness";
import { alternativeNoteOf, dayGuidanceOf } from "../dailyPlan/dayGuidance";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";

// SPORT-SAFE-01R.3 (HPM option B) — the day A10 replaced a refused endurance session (A04 modify_not_supported) by the
// active recovery: the guided session says the planned session is not offered and this one replaces it (the engine's
// own sentence), with M1's guidance; never on a read-only session; nothing on an ordinary A10 recovery.

const ENDURANCE = { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 45 } as const;
const m1 = buildDailyPlan(baseRawContext({ planned_session: ENDURANCE as never, active_mode: "UNSPECIFIED" as never, upcoming_races: [], checkin: { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 } as never }));
const before = { decision: "MODIFY" as const, kind: "AEROBIC_BASE", loadProfile: "LIGHT" as const, durationMin: 45 };
const tc = { availableMinutes: 30, action: "adapted" as const, before, after: { decision: "REPLACE" as const, kind: "RECOVERY_ACTIVE" } };
const refusal = { code: "final_prescription_adaptation_not_defined" as const, detail: { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 } };
const ALTERNATIVE = applyV2TodayTimeConstraint(m1, { status: "created", finalPrescription: {} as never, timeConstraint: tc, refusedModify: refusal } as never) as unknown as DailyPlan;
const ORDINARY_A10 = applyV2TodayTimeConstraint(m1, { status: "created", finalPrescription: {} as never, timeConstraint: tc } as never) as unknown as DailyPlan;
const SENTENCE =
  "Tu as 30 min aujourd'hui : la séance prévue n'est pas proposée (NALYNT n'en a pas de version guidée plus légère, et elle ne tient pas dans ce temps). Autre séance à la place : récupération active.";
const RECOVERY = prescriptionView("TIME_RECOVERY_25");
const note = () => screen.queryByTestId("alternative-note");
const phase = () => document.querySelector("[data-phase]")!.getAttribute("data-phase");

describe("SPORT-SAFE-01R.3 — the alternative to a refused session on the guided session", () => {
  it("the real decision: M1's MODIFY LIGHT 45 refused, A10's REPLACE active recovery, the engine's sentence; an ordinary A10 recovery has no note", () => {
    expect(isValidDailyPlan(ALTERNATIVE)).toBe(true);
    expect([m1.decision, ALTERNATIVE.decision, ALTERNATIVE.final_session]).toEqual(["MODIFY", "REPLACE", { kind: "RECOVERY_ACTIVE" }]);
    expect(alternativeNoteOf(ALTERNATIVE)).toBe(SENTENCE);
    expect(alternativeNoteOf(ORDINARY_A10)).toBeNull();
    expect(alternativeNoteOf(m1 as unknown as DailyPlan)).toBeNull();
  });

  it("before the start and once started: the note (planned session not offered, another session), then M1's guidance, then the recovery and its start button", async () => {
    const b = fakeBackend({ prescription: RECOVERY });
    b.state.alternativeNote = alternativeNoteOf(ALTERNATIVE);
    b.state.guidance = dayGuidanceOf(ALTERNATIVE);
    render(<Harness deps={b.deps} />);
    const start = await screen.findByRole("button", { name: "Commencer la séance" });
    expect(note()!.textContent).toBe(SENTENCE);
    expect(note()!.compareDocumentPosition(screen.getByTestId("day-guidance")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note()!.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/récupération active/i);
    expect(document.body.textContent).not.toMatch(/endurance.{0,20}(légère|LIGHT)/i);
    await userEvent.click(start);
    await waitFor(() => expect(phase()).toBe("active"));
    expect(note()!.textContent).toBe(SENTENCE);
  });

  it("stopped (read only): no note", async () => {
    const b = fakeBackend({ prescription: RECOVERY });
    b.state.alternativeNote = SENTENCE;
    render(<Harness deps={b.deps} />);
    await userEvent.click(await screen.findByRole("button", { name: "Commencer la séance" }));
    await waitFor(() => expect(phase()).toBe("active"));
    await userEvent.click(screen.getByRole("button", { name: "Arrêter la séance" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer l'arrêt" }));
    await waitFor(() => expect(phase()).toBe("abandoned"));
    expect(note()).toBeNull();
  });
});

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
const { loadGuidedSession } = await import("./guidedSessionLoader");

describe("loadGuidedSession — the alternative note (SPORT-SAFE-01R.3)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadDayExecutions.mockResolvedValue([]);
    loadDecisionCurrency.mockResolvedValue({ isCurrent: true, staleReason: null });
    loadOpenHealthFlags.mockResolvedValue([]);
    loadFinalPrescriptionV2State.mockResolvedValue({ kind: "created", prescription: RECOVERY });
    loadExecutionPrescription.mockResolvedValue({ kind: "created", prescription: RECOVERY });
  });
  const row = (id: string, dailyPlan: unknown) => ({ id, finalPrescriptionStatus: "created", isLatestOfDay: true, dailyPlan });

  it("before the start: the current decision's note", async () => {
    loadLatestDecisionForDate.mockResolvedValue(row("d1", ALTERNATIVE));
    expect(await loadGuidedSession("a1", "2026-10-09")).toMatchObject({ kind: "ready_to_start", alternativeNote: SENTENCE });
  });

  it("an ordinary A10 recovery: no note", async () => {
    loadLatestDecisionForDate.mockResolvedValue(row("d1", ORDINARY_A10));
    expect(await loadGuidedSession("a1", "2026-10-09")).not.toHaveProperty("alternativeNote");
  });

  it("started: the note of the execution's own decision", async () => {
    loadDayExecutions.mockResolvedValue([
      { id: "e1", session_date: "2026-10-09", decision_id: "d-exec", final_prescription_id: RECOVERY.id, started_at: "2026-10-09T17:00:00Z", recorded_at: "2026-10-09T17:00:00Z", execution_events: [{ event_type: "started", event_seq: 1 }], exercise_set_results: [], session_activity_results: [] },
    ]);
    loadLatestDecisionForDate.mockResolvedValue(row("d-new", ORDINARY_A10));
    loadDecisionById.mockResolvedValue(row("d-exec", ALTERNATIVE));
    expect(await loadGuidedSession("a1", "2026-10-09")).toMatchObject({ kind: "execution", phase: "active", alternativeNote: SENTENCE });
  });
});
