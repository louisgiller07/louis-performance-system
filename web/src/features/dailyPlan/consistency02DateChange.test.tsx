// CONSISTENCY-02 (HPM 2026-10-16, O-32) — Today's DailyPlanPanel when the date it is given changes while it stays
// mounted (a tab left open past midnight, a return to Today the next day, /simulation « +1 jour »): the previous
// day's decision is never presented as today's mission, a late answer for the previous day is ignored, and without a
// current decision for the new day the panel shows its explicit empty state (check-in first, or « Préparer ma séance
// du jour ») — never yesterday's mission, never a guided-session entry built from yesterday's prescription.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyPlanPanel } from "./DailyPlanPanel";

const signOut = vi.fn();
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ signOut }) }));
const { runDailyRun } = vi.hoisted(() => ({ runDailyRun: vi.fn() }));
vi.mock("./runDailyRun", () => ({ runDailyRun }));
const { loadLatestDecisionForDate } = vi.hoisted(() => ({ loadLatestDecisionForDate: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadLatestDecisionForDate }));
const { loadDecisionCurrency } = vi.hoisted(() => ({ loadDecisionCurrency: vi.fn() }));
vi.mock("./decisionCurrencyRepo", () => ({ loadDecisionCurrency }));

const D16 = "2026-10-16";
const D17 = "2026-10-17";

const plan = (reasoning: string, decision = "REPLACE", rules: string[] = []) => ({
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "RECOVERY_ACTIVE", load_profile: "LIGHT" }, objective: reasoning },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  triggered_rules: rules.map((rule_id) => ({ rule_id, layer: "SAFETY", detail: "Signal de suivi ouvert." })),
  planned_session_before: null,
  final_session: decision === "REST" ? { kind: "REST" } : { kind: "RECOVERY_ACTIVE", load_profile: "LIGHT", duration_min: 30 },
  overrode_race_protocol: false,
  engine_version: "1.0.0",
  decision,
  confidence: "HIGH",
  reasoning,
});
const TODAY_PROPS = { hideIdleWithoutCheckin: true, runningSlot: <p>analysis-slot</p>, loadingSlot: <p>loading-slot</p> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const missionOf16 = () => screen.queryAllByText(/Mission du 16 octobre/);

beforeEach(() => {
  vi.resetAllMocks();
  loadDecisionCurrency.mockResolvedValue({ isCurrent: true, staleReason: null });
});

describe("CONSISTENCY-02 — Today's mission after a date change", () => {
  it("no decision for the new day, no check-in yet: yesterday's mission is gone (check-in first)", async () => {
    loadLatestDecisionForDate.mockImplementation(async (_a: string, date: string) => (date === D16 ? { id: "d-16", dailyPlan: plan("Mission du 16 octobre") } : null));
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    expect((await screen.findAllByText(/Mission du 16 octobre/)).length).toBeGreaterThan(0);

    rerender(<DailyPlanPanel athleteId="a-1" date={D17} hasCheckin={false} checkinRevision={0} {...TODAY_PROPS} />);
    expect(missionOf16()).toHaveLength(0); // not even for the render that precedes the new day's read
    await waitFor(() => expect(loadLatestDecisionForDate).toHaveBeenCalledWith("a-1", D17));
    await waitFor(() => expect(screen.queryByText("loading-slot")).not.toBeInTheDocument());
    expect(missionOf16()).toHaveLength(0);
  });

  it("no decision for the new day, today's check-in saved: the explicit « Préparer ma séance du jour », nothing of yesterday", async () => {
    loadLatestDecisionForDate.mockImplementation(async (_a: string, date: string) => (date === D16 ? { id: "d-16", dailyPlan: plan("Mission du 16 octobre") } : null));
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    await screen.findAllByText(/Mission du 16 octobre/);
    rerender(<DailyPlanPanel athleteId="a-1" date={D17} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    expect(await screen.findByRole("button", { name: "Préparer ma séance du jour" })).toBeEnabled();
    expect(missionOf16()).toHaveLength(0);
  });

  it("a stale decision for the new day: the notice and the button, never yesterday's mission next to it", async () => {
    loadLatestDecisionForDate.mockImplementation(async (_a: string, date: string) =>
      date === D16 ? { id: "d-16", dailyPlan: plan("Mission du 16 octobre") } : { id: "d-17", dailyPlan: plan("Mission du 17 octobre (ancienne)") }
    );
    loadDecisionCurrency.mockImplementation(async (id: string) => (id === "d-16" ? { isCurrent: true, staleReason: null } : { isCurrent: false, staleReason: "planned_session_changed" }));
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    await screen.findAllByText(/Mission du 16 octobre/);
    rerender(<DailyPlanPanel athleteId="a-1" date={D17} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    expect(await screen.findByText("Ta séance prévue a changé. Génère un nouveau plan.")).toBeInTheDocument();
    expect(missionOf16()).toHaveLength(0);
    expect(screen.queryAllByText(/Mission du 17 octobre/)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Préparer ma séance du jour" })).toBeInTheDocument();
  });

  it("a late answer for the previous day (read started before midnight) is ignored", async () => {
    const late = deferred<{ id: string; dailyPlan: ReturnType<typeof plan> } | null>();
    loadLatestDecisionForDate.mockImplementation((_a: string, date: string) => (date === D16 ? late.promise : Promise.resolve(null)));
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    rerender(<DailyPlanPanel athleteId="a-1" date={D17} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    expect(await screen.findByRole("button", { name: "Préparer ma séance du jour" })).toBeInTheDocument();
    await act(async () => late.resolve({ id: "d-16", dailyPlan: plan("Mission du 16 octobre") }));
    expect(missionOf16()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Préparer ma séance du jour" })).toBeInTheDocument();
  });

  it("an analysis still running for the previous day when the day changes: its result is never shown, nothing is reported as today's decision", async () => {
    loadLatestDecisionForDate.mockResolvedValue(null);
    const run = deferred<unknown>();
    runDailyRun.mockReturnValue(run.promise);
    const onDecision = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} onDecision={onDecision} {...TODAY_PROPS} />);
    await user.click(await screen.findByRole("button", { name: "Préparer ma séance du jour" }));
    expect(runDailyRun).toHaveBeenCalledWith(D16);
    rerender(<DailyPlanPanel athleteId="a-1" date={D17} hasCheckin={true} checkinRevision={0} onDecision={onDecision} {...TODAY_PROPS} />);
    await act(async () => run.resolve({ ok: true, data: { dailyPlan: plan("Mission du 16 octobre"), decisionId: "d-16", healthFlagId: null, warnings: [] } }));
    expect(missionOf16()).toHaveLength(0);
    expect(onDecision).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Préparer ma séance du jour" })).toBeEnabled();
  });

  it("yesterday's health rest (A7) is not reused as today's mission; the guided entry never gets yesterday's prescription", async () => {
    loadLatestDecisionForDate.mockImplementation(async (_a: string, date: string) => (date === D16 ? { id: "d-16", dailyPlan: plan("Mission du 16 octobre", "REST", ["A7"]) } : null));
    const entries: { dailyPlan: unknown; finalPrescriptionCreated: boolean }[] = [];
    const guidedSessionEntry = (args: { dailyPlan: unknown; finalPrescriptionCreated: boolean }) => {
      entries.push(args);
      return null;
    };
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} guidedSessionEntry={guidedSessionEntry} {...TODAY_PROPS} />);
    await waitFor(() => expect(entries.some((e) => e.dailyPlan !== null)).toBe(true));
    entries.length = 0;
    rerender(<DailyPlanPanel athleteId="a-1" date={D17} hasCheckin={true} checkinRevision={0} guidedSessionEntry={guidedSessionEntry} {...TODAY_PROPS} />);
    await screen.findByRole("button", { name: "Préparer ma séance du jour" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.dailyPlan === null && e.finalPrescriptionCreated === false)).toBe(true);
    expect(missionOf16()).toHaveLength(0);
  });

  it("no loop, no double read: a re-render on the same day keeps the mission and reads the decision once", async () => {
    loadLatestDecisionForDate.mockImplementation(async () => ({ id: "d-16", dailyPlan: plan("Mission du 16 octobre") }));
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    await screen.findAllByText(/Mission du 16 octobre/);
    rerender(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    rerender(<DailyPlanPanel athleteId="a-1" date={D16} hasCheckin={true} checkinRevision={0} {...TODAY_PROPS} />);
    expect(missionOf16().length).toBeGreaterThan(0);
    expect(loadLatestDecisionForDate).toHaveBeenCalledTimes(1);
    expect(runDailyRun).not.toHaveBeenCalled();
  });
});
