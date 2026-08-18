import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayPage } from "./TodayPage";
import { todayLocal } from "../lib/date";

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
  CheckinForm: ({ athleteId, date }: { athleteId: string; date: string }) => (
    <div data-testid="checkin-form-stub">
      checkin-form athlete={athleteId} date={date}
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

    render(<TodayPage />);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders the real CheckinForm, wired with athleteId and the canonical date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    const expectedDate = todayLocal();

    render(<TodayPage />);

    expect(screen.getByText("Daily Check-in")).toBeInTheDocument();
    expect(screen.getByTestId("checkin-form-stub")).toHaveTextContent(`checkin-form athlete=athlete-1 date=${expectedDate}`);
  });

  it("displays the Daily Plan placeholder", () => {
    render(<TodayPage />);

    expect(screen.getByText("Daily Plan")).toBeInTheDocument();
    expect(screen.getByText(/Disponible après check-in/)).toBeInTheDocument();
  });

  it("logout button calls signOut", () => {
    render(<TodayPage />);

    screen.getByText("Logout").click();

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
