// CONSISTENCY-02 (HPM 2026-10-16, O-32) — the date every page treats as "today" (useEffectiveToday) follows the real
// calendar while a page stays open: at the next local midnight, and when the tab comes back to the foreground (a
// background tab's timers are throttled). The simulation athlete's « +1 jour » date is distinct from the real
// calendar: real midnight never moves it, only the simulation does. Controlled clock, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { msUntilNextLocalMidnight, useEffectiveToday, writeSimulatedDate } from "./simulationClock";

const auth = vi.hoisted(() => ({ athleteId: "rider-1" as string | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ athleteId: auth.athleteId }) }));

let renders = 0;
function Today() {
  renders += 1;
  return <p data-testid="today">{useEffectiveToday()}</p>;
}
const shown = () => screen.getByTestId("today").textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  auth.athleteId = "rider-1";
  renders = 0;
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("CONSISTENCY-02 — « today » while a page stays open", () => {
  it("before and after midnight: the open page moves to the new day at midnight, by itself", () => {
    vi.setSystemTime(new Date(2026, 9, 16, 23, 59, 30));
    render(<Today />);
    expect(shown()).toBe("2026-10-16");
    act(() => vi.advanceTimersByTime(20_000)); // 23:59:50 — still the 16th, no extra render
    expect(shown()).toBe("2026-10-16");
    const before = renders;
    act(() => vi.advanceTimersByTime(15_000)); // past midnight
    expect(shown()).toBe("2026-10-17");
    expect(renders).toBe(before + 1);
    act(() => vi.advanceTimersByTime(24 * 3600_000)); // and again the next midnight (re-armed)
    expect(shown()).toBe("2026-10-18");
  });

  it("back on the tab the next morning (timers frozen in the background): the page shows the new day as soon as it is visible", () => {
    vi.setSystemTime(new Date(2026, 9, 16, 22, 0, 0));
    render(<Today />);
    expect(shown()).toBe("2026-10-16");
    vi.setSystemTime(new Date(2026, 9, 17, 7, 30, 0)); // the clock moved, no timer fired
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(shown()).toBe("2026-10-17");
  });

  it("returning or focusing on the same day re-renders nothing", () => {
    vi.setSystemTime(new Date(2026, 9, 16, 10, 0, 0));
    render(<Today />);
    const before = renders;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(renders).toBe(before);
  });

  it("the simulation date (« +1 jour ») is not the real calendar: real midnight never moves it, the simulation does", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "sim-athlete");
    auth.athleteId = "sim-athlete";
    vi.setSystemTime(new Date(2026, 9, 16, 23, 59, 30));
    writeSimulatedDate("2026-11-02");
    const { rerender } = render(<Today />);
    expect(shown()).toBe("2026-11-02");
    act(() => vi.advanceTimersByTime(60_000)); // real midnight
    expect(shown()).toBe("2026-11-02");
    writeSimulatedDate("2026-11-03"); // SimulationLabPage « +1 jour », then its own re-render
    rerender(<Today />);
    expect(shown()).toBe("2026-11-03");
  });

  describe("around the Europe/Zurich clock changes", () => {
    const previousTz = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = "Europe/Zurich";
    });
    afterEach(() => {
      process.env.TZ = previousTz;
    });

    it("the next midnight is computed in calendar days: 25 h on the autumn change day, 23 h on the spring one", () => {
      expect(msUntilNextLocalMidnight(new Date(2026, 9, 25, 0, 0, 0))).toBe(25 * 3600_000); // 2026-10-25, 03:00 → 02:00
      expect(msUntilNextLocalMidnight(new Date(2026, 2, 29, 0, 0, 0))).toBe(23 * 3600_000); // 2026-03-29, 02:00 → 03:00
      expect(msUntilNextLocalMidnight(new Date(2026, 9, 16, 23, 59, 30))).toBe(30_000);
    });

    it("an open page crosses the autumn change night and lands on the right day", () => {
      vi.setSystemTime(new Date(2026, 9, 24, 23, 59, 0));
      render(<Today />);
      expect(shown()).toBe("2026-10-24");
      act(() => vi.advanceTimersByTime(2 * 60_000));
      expect(shown()).toBe("2026-10-25");
      act(() => vi.advanceTimersByTime(25 * 3600_000)); // the 25-hour day
      expect(shown()).toBe("2026-10-26");
    });
  });
});
