import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayPage } from "./TodayPage";
import { todayLocal } from "../lib/date";

const signOut = vi.fn();

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "louis@example.test" },
    signOut,
  }),
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

  it("displays the Daily Check-in placeholder", () => {
    render(<TodayPage />);

    expect(screen.getByText("Daily Check-in")).toBeInTheDocument();
    expect(screen.getByText(/Formulaire disponible dans M4_003/)).toBeInTheDocument();
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
