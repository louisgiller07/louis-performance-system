import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodayPage } from "./TodayPage";
import { todayLocal } from "../lib/date";
import { writeSimulatedDate } from "../lib/simulationClock";

function renderTodayPage() {
  return render(
    <MemoryRouter initialEntries={["/today"]}>
      <TodayPage />
    </MemoryRouter>
  );
}

const signOut = vi.fn();

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "louis@example.test" },
    athleteId: "athlete-1",
    signOut,
  }),
}));

// CheckinForm's own behavior (load/save/validation) is covered by
// src/features/checkin/CheckinForm.test.tsx — TodayPage only needs to prove
// it's wired in with the right athleteId/date, not re-test its internals.
vi.mock("../features/checkin/CheckinForm", () => ({
  CheckinForm: ({
    athleteId,
    date,
    onCheckinAvailabilityChange,
    onSaved,
  }: {
    athleteId: string;
    date: string;
    onCheckinAvailabilityChange?: (hasCheckin: boolean) => void;
    onSaved?: () => void;
  }) => (
    <div data-testid="checkin-form-stub">
      checkin-form athlete={athleteId} date={date}
      <button onClick={() => onCheckinAvailabilityChange?.(true)}>simulate checkin available (load)</button>
      <button
        onClick={() => {
          onCheckinAvailabilityChange?.(true);
          onSaved?.();
        }}
      >
        simulate checkin saved
      </button>
    </div>
  ),
}));

// TodayPlanningSummary's own behavior (states, legacy handling, error
// isolation, /plan link) is covered by
// src/features/planning/TodayPlanningSummary.test.tsx — TodayPage only
// needs to prove it's wired in with the right athleteId/date.
vi.mock("../features/planning/TodayPlanningSummary", () => ({
  TodayPlanningSummary: ({ athleteId, date }: { athleteId: string; date: string }) => (
    <div data-testid="today-planning-summary-stub">
      today-planning-summary athlete={athleteId} date={date}
    </div>
  ),
}));

// DailyPlanPanel's own behavior is covered by
// src/features/dailyPlan/DailyPlanPanel.test.tsx — TodayPage only needs to
// prove it's wired in with the right date/hasCheckin/checkinRevision.
// V0.3_007B removed onLiveContextChange entirely — CompletedSessionCard now
// resolves its own decision link via loadValidDecisionsForDate, never via
// "whatever DailyPlanPanel currently shows".
vi.mock("../features/dailyPlan/DailyPlanPanel", () => ({
  DailyPlanPanel: ({ date, hasCheckin, checkinRevision }: { date: string; hasCheckin: boolean; checkinRevision: number }) => (
    <div data-testid="daily-plan-panel-stub">
      daily-plan-panel date={date} hasCheckin={String(hasCheckin)} checkinRevision={checkinRevision}
    </div>
  ),
}));

// CompletedSessionCard's own behavior is covered by
// src/features/completedSession/CompletedSessionCard.test.tsx — TodayPage
// only needs to prove it's wired in with the right athleteId/date.
vi.mock("../features/completedSession/CompletedSessionCard", () => ({
  CompletedSessionCard: ({ date, athleteId }: { date: string; athleteId: string }) => (
    <div data-testid="completed-session-card-stub">
      completed-session-card date={date} athleteId={athleteId}
    </div>
  ),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

describe("TodayPage", () => {
  it("renders the current canonical local date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expected = todayLocal();

    renderTodayPage();

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders the real CheckinForm, wired with athleteId and the canonical date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    renderTodayPage();

    expect(screen.getByText("Check-in")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent(`checkin-form athlete=athlete-1 date=${expectedDate}`);
  });

  it("renders TodayPlanningSummary wired with athleteId and the canonical date (K)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    renderTodayPage();

    expect(screen.getByTestId("today-planning-summary-stub")).toHaveTextContent(`today-planning-summary athlete=athlete-1 date=${expectedDate}`);
  });

  it("keeps Prévu aujourd'hui (Planning) and the Head Coach decision panel as distinct, coexisting sections (J)", () => {
    renderTodayPage();

    expect(screen.getByTestId("today-planning-summary-stub")).toBeInTheDocument();
    expect(screen.getByTestId("daily-plan-panel-stub")).toBeInTheDocument();
  });

  it("renders the real DailyPlanPanel, wired with the canonical date, hasCheckin=false and checkinRevision=0 initially", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    renderTodayPage();

    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent(
      `daily-plan-panel date=${expectedDate} hasCheckin=false checkinRevision=0`
    );
  });

  it("passes hasCheckin=true to DailyPlanPanel once CheckinForm reports a checkin is available, without bumping checkinRevision", async () => {
    renderTodayPage();

    screen.getByText("simulate checkin available (load)").click();

    const stub = await screen.findByTestId("daily-plan-panel-stub");
    expect(stub).toHaveTextContent("hasCheckin=true");
    expect(stub).toHaveTextContent("checkinRevision=0");
  });

  it("bumps checkinRevision only when CheckinForm reports an actual save (onSaved)", async () => {
    renderTodayPage();

    screen.getByText("simulate checkin saved").click();

    const stub = await screen.findByTestId("daily-plan-panel-stub");
    expect(stub).toHaveTextContent("checkinRevision=1");

    screen.getByText("simulate checkin saved").click();
    expect(await screen.findByTestId("daily-plan-panel-stub")).toHaveTextContent("checkinRevision=2");
  });

  it("logout button calls signOut", () => {
    renderTodayPage();

    screen.getByText("Déconnexion").click();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("renders CompletedSessionCard wired with the canonical date and athleteId — no live decision context is threaded through anymore (V0.3_007B)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    renderTodayPage();

    expect(screen.getByTestId("completed-session-card-stub")).toHaveTextContent(`completed-session-card date=${expectedDate} athleteId=athlete-1`);
  });

  it("V0.3.010 (SIM-001): for the configured simulation athlete, every date-dependent child uses the simulated date instead of todayLocal() — real /today (no simulation configured) is unaffected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const realToday = todayLocal();

    // The mocked useAuth() in this file always resolves athleteId="athlete-1"
    // — configuring the simulation athlete to that same id, plus a stored
    // simulated date, exercises the real simulationClock.ts logic end to
    // end (no mocking of the hook itself needed).
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "athlete-1");
    writeSimulatedDate("2026-09-20");

    render(
      <MemoryRouter initialEntries={["/simulation"]}>
        <TodayPage />
      </MemoryRouter>
    );

    expect(screen.getByText("2026-09-20")).toBeInTheDocument();
    expect(screen.queryByText(realToday)).not.toBeInTheDocument();
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent("date=2026-09-20");
    expect(screen.getByTestId("today-planning-summary-stub")).toHaveTextContent("date=2026-09-20");
    expect(screen.getByTestId("daily-plan-panel-stub")).toHaveTextContent("date=2026-09-20");
    expect(screen.getByTestId("completed-session-card-stub")).toHaveTextContent("date=2026-09-20");
  });

  it("real /today: an unconfigured or non-matching simulation athlete ID never affects the date, even if a simulated date happens to be stored", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const realToday = todayLocal();

    // No VITE_SIMULATION_ATHLETE_ID stubbed here — matches real production
    // for every athlete except the one dedicated simulation account.
    writeSimulatedDate("2026-09-20");

    renderTodayPage();

    expect(screen.getByText(realToday)).toBeInTheDocument();
    expect(screen.queryByText("2026-09-20")).not.toBeInTheDocument();
  });
});
