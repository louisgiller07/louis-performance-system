import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TodayPage } from "./TodayPage";
import { todayLocal } from "../lib/date";

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

// DailyPlanPanel's own behavior is covered by
// src/features/dailyPlan/DailyPlanPanel.test.tsx — TodayPage only needs to
// prove it's wired in with the right date/hasCheckin/checkinRevision, and
// that it correctly forwards onLiveContextChange into liveContext.
vi.mock("../features/dailyPlan/DailyPlanPanel", () => ({
  DailyPlanPanel: ({
    date,
    hasCheckin,
    checkinRevision,
    onLiveContextChange,
  }: {
    date: string;
    hasCheckin: boolean;
    checkinRevision: number;
    onLiveContextChange?: (context: { decisionId: string; sessionType: string } | null) => void;
  }) => (
    <div data-testid="daily-plan-panel-stub">
      daily-plan-panel date={date} hasCheckin={String(hasCheckin)} checkinRevision={checkinRevision}
      <button onClick={() => onLiveContextChange?.({ decisionId: "decision-live-1", sessionType: "AEROBIC_BASE" })}>
        simulate daily-run success
      </button>
      <button onClick={() => onLiveContextChange?.(null)}>simulate daily-run invalidated</button>
    </div>
  ),
}));

// CompletedSessionCard's own behavior is covered by
// src/features/completedSession/CompletedSessionCard.test.tsx — TodayPage
// only needs to prove it's wired in with the right date/liveContext (never
// a "latest decision" lookup of its own).
vi.mock("../features/completedSession/CompletedSessionCard", () => ({
  CompletedSessionCard: ({ date, liveContext }: { date: string; liveContext: { decisionId: string; sessionType: string } | null }) => (
    <div data-testid="completed-session-card-stub">
      completed-session-card date={date} liveContext={JSON.stringify(liveContext)}
    </div>
  ),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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

    expect(screen.getByText("Daily Check-in")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent(`checkin-form athlete=athlete-1 date=${expectedDate}`);
  });

  it("renders the real DailyPlanPanel, wired with the canonical date, hasCheckin=false and checkinRevision=0 initially", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    renderTodayPage();

    expect(screen.getByText("Daily Plan")).toBeInTheDocument();
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

    screen.getByText("Logout").click();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("renders CompletedSessionCard wired with the canonical date and liveContext=null initially", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    renderTodayPage();

    expect(screen.getByTestId("completed-session-card-stub")).toHaveTextContent(`completed-session-card date=${expectedDate} liveContext=null`);
  });

  it("passes the exact decisionId + sessionType to CompletedSessionCard once DailyPlanPanel reports them", async () => {
    renderTodayPage();

    screen.getByText("simulate daily-run success").click();

    expect(await screen.findByTestId("completed-session-card-stub")).toHaveTextContent(
      JSON.stringify({ decisionId: "decision-live-1", sessionType: "AEROBIC_BASE" })
    );
  });

  it("resets liveContext to null when DailyPlanPanel reports the plan is no longer current — never keeps a stale decision/session-type", async () => {
    renderTodayPage();

    screen.getByText("simulate daily-run success").click();
    expect(await screen.findByTestId("completed-session-card-stub")).toHaveTextContent(
      JSON.stringify({ decisionId: "decision-live-1", sessionType: "AEROBIC_BASE" })
    );

    screen.getByText("simulate daily-run invalidated").click();
    expect(await screen.findByTestId("completed-session-card-stub")).toHaveTextContent("liveContext=null");
  });
});
