import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { isSimulationAthlete, readSimulatedDate, writeSimulatedDate, useEffectiveToday } from "./simulationClock";
import { todayLocal } from "./date";

let mockAthleteId: string | null = "athlete-1";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ athleteId: mockAthleteId }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  sessionStorage.clear();
  mockAthleteId = "athlete-1";
});

describe("isSimulationAthlete", () => {
  it("is false when VITE_SIMULATION_ATHLETE_ID is not configured, regardless of athleteId", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "");
    expect(isSimulationAthlete("athlete-1")).toBe(false);
    expect(isSimulationAthlete(null)).toBe(false);
  });

  it("is false when athleteId does not match the configured simulation athlete", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "sim-athlete");
    expect(isSimulationAthlete("athlete-1")).toBe(false);
    expect(isSimulationAthlete(null)).toBe(false);
  });

  it("is true only when athleteId exactly matches the configured simulation athlete", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "sim-athlete");
    expect(isSimulationAthlete("sim-athlete")).toBe(true);
  });
});

describe("readSimulatedDate / writeSimulatedDate", () => {
  it("returns null when nothing has been written yet", () => {
    expect(readSimulatedDate()).toBeNull();
  });

  it("round-trips a written date", () => {
    writeSimulatedDate("2026-09-20");
    expect(readSimulatedDate()).toBe("2026-09-20");
  });
});

describe("useEffectiveToday", () => {
  it("returns todayLocal() for a real (non-simulation) athlete, even if a simulated date is stored", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "sim-athlete");
    mockAthleteId = "athlete-1"; // Louis, not the simulation athlete
    writeSimulatedDate("2026-09-20");

    const { result } = renderHook(() => useEffectiveToday());

    expect(result.current).toBe(todayLocal());
  });

  it("returns the stored simulated date for the configured simulation athlete", () => {
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "sim-athlete");
    mockAthleteId = "sim-athlete";
    writeSimulatedDate("2026-09-20");

    const { result } = renderHook(() => useEffectiveToday());

    expect(result.current).toBe("2026-09-20");
  });

  it("falls back to todayLocal() for the simulation athlete when no simulated date has been set yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T09:00:00Z"));
    vi.stubEnv("VITE_SIMULATION_ATHLETE_ID", "sim-athlete");
    mockAthleteId = "sim-athlete";

    const { result } = renderHook(() => useEffectiveToday());

    expect(result.current).toBe(todayLocal());
  });
});
