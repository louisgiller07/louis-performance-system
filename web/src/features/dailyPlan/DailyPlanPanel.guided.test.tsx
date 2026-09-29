import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DailyPlanPanel } from "./DailyPlanPanel";

// UX-03 — Today's opt-in props. The historical default behavior stays
// covered by DailyPlanPanel.test.tsx (unchanged).
const signOut = vi.fn();
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ signOut }) }));
vi.mock("./runDailyRun", () => ({ runDailyRun: vi.fn() }));
const { loadLatestDecisionForDate } = vi.hoisted(() => ({ loadLatestDecisionForDate: vi.fn() }));
vi.mock("../history/historyRepo", () => ({ loadLatestDecisionForDate }));
const { loadDecisionCurrency } = vi.hoisted(() => ({ loadDecisionCurrency: vi.fn() }));
vi.mock("./decisionCurrencyRepo", () => ({ loadDecisionCurrency }));

import { runDailyRun } from "./runDailyRun";
const mockedRun = runDailyRun as unknown as ReturnType<typeof vi.fn>;

const PLAN = {
  active_mode: "IN_SEASON",
  training: { active: true, session_type: { kind: "AEROBIC_BASE", load_profile: "MODERATE" }, objective: "Base aérobie" },
  dh_or_technical: { active: false },
  mental: { active: false },
  recovery: { active: false, actions: [] },
  nutrition: { active: false },
  sleep: { active: false },
  protection: { do_not_do: [] },
  monitoring: { observe: [] },
  triggered_rules: [],
  planned_session_before: { kind: "AEROBIC_BASE", load_profile: "MODERATE" },
  final_session: { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 60 },
  overrode_race_protocol: false,
  engine_version: "1.0.0",
  decision: "KEEP",
  confidence: "HIGH",
  reasoning: "Tout va bien.",
};
const RESPONSE = { ok: true, data: { dailyPlan: PLAN, decisionId: "d-1", healthFlagId: null, warnings: [] } };

beforeEach(() => {
  vi.resetAllMocks();
  loadLatestDecisionForDate.mockResolvedValue(null);
  loadDecisionCurrency.mockResolvedValue({ isCurrent: true, staleReason: null });
});

const GUIDED = { hideIdleWithoutCheckin: true, autoGenerateOnCheckinSave: true, runningSlot: <p>analysis-slot</p>, loadingSlot: <p>loading-slot</p> };

describe("DailyPlanPanel — Today's guided flow props (UX-03)", () => {
  it("loadingSlot replaces the plain loading text while today's decision is restored", async () => {
    loadLatestDecisionForDate.mockReturnValue(new Promise(() => {}));
    render(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={false} checkinRevision={0} {...GUIDED} />);

    expect(screen.getByText("loading-slot")).toBeInTheDocument();
    expect(screen.queryByText("Chargement de ton plan…")).not.toBeInTheDocument();
  });

  it("hideIdleWithoutCheckin: nothing at all without a check-in (no disabled button, no hint)", async () => {
    const { container } = render(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={false} checkinRevision={0} {...GUIDED} />);

    await waitFor(() => expect(loadLatestDecisionForDate).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("a restored current decision is still shown (no button above the mission)", async () => {
    loadLatestDecisionForDate.mockResolvedValue({ id: "d-0", dailyPlan: PLAN });
    render(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={true} checkinRevision={0} {...GUIDED} />);

    expect(await screen.findByText("Ta mission du jour")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Préparer ma séance du jour/ })).not.toBeInTheDocument();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("autoGenerateOnCheckinSave: a new checkinRevision runs the daily run once, shows the runningSlot meanwhile, then the mission", async () => {
    let resolveRun!: (value: unknown) => void;
    mockedRun.mockReturnValue(new Promise((resolve) => (resolveRun = resolve)));
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={false} checkinRevision={0} {...GUIDED} />);
    await waitFor(() => expect(loadLatestDecisionForDate).toHaveBeenCalled());

    rerender(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={true} checkinRevision={1} {...GUIDED} />);

    expect(await screen.findByText("analysis-slot")).toBeInTheDocument();
    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(mockedRun).toHaveBeenCalledWith("2026-09-29");

    resolveRun(RESPONSE);
    expect(await screen.findByText("Ta mission du jour")).toBeInTheDocument();
    expect(screen.queryByText("analysis-slot")).not.toBeInTheDocument();
  });

  it("merely loading an existing check-in (hasCheckin flips, same revision) never auto-runs", async () => {
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={false} checkinRevision={0} {...GUIDED} />);
    await waitFor(() => expect(loadLatestDecisionForDate).toHaveBeenCalled());

    rerender(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={true} checkinRevision={0} {...GUIDED} />);

    expect(await screen.findByRole("button", { name: /Préparer ma séance du jour/ })).toBeEnabled();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("minAnalysisMs keeps the analysis visible at least that long before the reveal (pacing only, one request)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedRun.mockResolvedValue(RESPONSE);
    const { rerender } = render(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={false} checkinRevision={0} minAnalysisMs={1500} {...GUIDED} />);
    await waitFor(() => expect(loadLatestDecisionForDate).toHaveBeenCalled());

    rerender(<DailyPlanPanel athleteId="a-1" date="2026-09-29" hasCheckin={true} checkinRevision={1} minAnalysisMs={1500} {...GUIDED} />);
    expect(await screen.findByText("analysis-slot")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.getByText("analysis-slot")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1100);
    expect(await screen.findByText("Ta mission du jour")).toBeInTheDocument();
    expect(mockedRun).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
