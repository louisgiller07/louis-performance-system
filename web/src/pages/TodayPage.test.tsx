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
// prove it's wired in with the right date/hasCheckin/checkinRevision.
vi.mock("../features/dailyPlan/DailyPlanPanel", () => ({
  DailyPlanPanel: ({ date, hasCheckin, checkinRevision }: { date: string; hasCheckin: boolean; checkinRevision: number }) => (
    <div data-testid="daily-plan-panel-stub">
      daily-plan-panel date={date} hasCheckin={String(hasCheckin)} checkinRevision={checkinRevision}
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
});
