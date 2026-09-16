import { useAuth } from "../auth/AuthContext";
import { todayLocal } from "./date";

// V0.3.010 (SIM-001) — single shared source of "what date should the UI
// treat as today". Before this, TodayPage received an explicit `date` prop
// from SimulationLabPage while every other page (PlanPage) called
// `todayLocal()` directly — two different mechanisms, so Planning silently
// fell back to the real date past whatever the simulated clock said. This
// file is now the ONLY place that decides "real vs simulated" — every page
// that needs "today" calls `useEffectiveToday()` instead of `todayLocal()`
// directly, so the answer is consistent everywhere the simulation athlete
// goes (not just wherever a parent happened to pass a prop down).
//
// UX guard only, same as SimulationLabPage's own check — NEVER a security
// boundary. RLS is what actually isolates the simulation athlete's writes;
// this only decides which date string a real, already-authorized request
// uses.
const SIMULATION_DATE_STORAGE_KEY = "nalynt-simulation-date";

export function isSimulationAthlete(athleteId: string | null): boolean {
  const simulationAthleteId = import.meta.env.VITE_SIMULATION_ATHLETE_ID;
  return Boolean(simulationAthleteId) && athleteId === simulationAthleteId;
}

export function readSimulatedDate(): string | null {
  try {
    return sessionStorage.getItem(SIMULATION_DATE_STORAGE_KEY);
  } catch {
    // Private browsing / storage disabled — behave as if no simulated date
    // were set (falls back to today), same as a fresh session would.
    return null;
  }
}

export function writeSimulatedDate(date: string): void {
  try {
    sessionStorage.setItem(SIMULATION_DATE_STORAGE_KEY, date);
  } catch {
    // Best-effort only — losing persistence just means the clock resets to
    // today on next reload, not a correctness issue for the engine itself.
  }
}

/**
 * The date every page should treat as "today". Real athletes (including
 * Louis) always get `todayLocal()` — identical to the pre-V0.3.010
 * behavior, unconditionally. Only the configured simulation athlete
 * (`VITE_SIMULATION_ATHLETE_ID`) ever sees a simulated date, and only once
 * one has actually been set (SimulationLabPage's "+1 jour").
 */
export function useEffectiveToday(): string {
  const { athleteId } = useAuth();
  if (isSimulationAthlete(athleteId)) {
    return readSimulatedDate() ?? todayLocal();
  }
  return todayLocal();
}
