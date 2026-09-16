import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { todayLocal, addDays } from "../lib/date";
import { TodayPage } from "./TodayPage";

const SIMULATION_DATE_STORAGE_KEY = "nalynt-simulation-date";

function loadStoredSimulatedDate(): string | null {
  try {
    return sessionStorage.getItem(SIMULATION_DATE_STORAGE_KEY);
  } catch {
    // Private browsing / storage disabled — fall back to today, same as a
    // fresh session would.
    return null;
  }
}

function storeSimulatedDate(date: string): void {
  try {
    sessionStorage.setItem(SIMULATION_DATE_STORAGE_KEY, date);
  } catch {
    // Best-effort only — losing persistence just means the clock resets to
    // today on next reload, not a correctness issue for the engine itself.
  }
}

/**
 * V0.3.009 — Simulation Lab. Internal validation tool: lets a reviewer
 * advance a simulated date day-by-day and drive the real `/today` flow
 * (check-in → prescription → séance → feedback) against it, to test
 * longitudinal memory across several simulated days without waiting real
 * weeks. See docs/11_DECISION_LOG.md (V0.3.009) for the full architecture
 * decision.
 *
 * Deliberately NOT simulation-aware beyond this one page: the injected
 * `date` is the ONLY thing that differs from real usage (TodayPage.tsx),
 * daily-run/head-coach-engine/coaching rules are entirely unmodified and
 * have no idea a simulation is happening.
 *
 * The athlete-identity check below is a UX convenience ONLY — it exists so
 * the wrong account sees a clear refusal instead of a confusing broken UI.
 * It is NEVER the real security boundary: every actual write (check-in,
 * daily-run, completed-session) is still enforced server-side by RLS
 * exactly as for any other athlete, and the reset function (Phase 2)
 * re-checks the athlete_id itself against a server-only secret — a client
 * bypassing or spoofing this check gains no access it wouldn't already
 * have under RLS for its own account.
 */
export function SimulationLabPage() {
  const { user, athleteId } = useAuth();

  const simulationAthleteId = import.meta.env.VITE_SIMULATION_ATHLETE_ID;
  const isSimulationAthlete = Boolean(simulationAthleteId) && athleteId === simulationAthleteId;

  const realDate = todayLocal();
  const [simulatedDate, setSimulatedDate] = useState(() => loadStoredSimulatedDate() ?? realDate);

  const daysElapsed = useMemo(() => {
    // Purely for display ("Jour N") — not consumed by anything date-logic
    // related, so a simple diff via repeated addDays comparison is fine
    // (avoids importing engine-side calendar-day utilities into web/).
    let count = 1;
    let cursor = realDate;
    while (cursor < simulatedDate) {
      cursor = addDays(cursor, 1);
      count += 1;
    }
    return count;
  }, [realDate, simulatedDate]);

  function advanceOneDay() {
    const next = addDays(simulatedDate, 1);
    setSimulatedDate(next);
    storeSimulatedDate(next);
  }

  if (!isSimulationAthlete) {
    return (
      <div className="mx-auto mt-24 max-w-sm p-6 text-center">
        <p className="text-sm font-semibold text-red-600">Accès refusé</p>
        <p className="mt-2 text-sm text-gray-600">
          Cette page est réservée au compte de simulation interne. Le compte connecté ({user?.email ?? "inconnu"}) n'y a
          pas accès.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <header className="flex flex-col gap-2 border-b-2 border-amber-400 bg-amber-50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Mode simulation</p>
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Athlète : {user?.email ?? "—"}</span>
          <span>Jour {daysElapsed}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-500">Date réelle</p>
            <p className="font-mono text-gray-900">{realDate}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Date simulée</p>
            <p className="font-mono font-semibold text-amber-700">{simulatedDate}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={advanceOneDay}
          className="mt-1 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white active:bg-amber-700"
        >
          +1 jour
        </button>
      </header>

      <TodayPage date={simulatedDate} />
    </div>
  );
}
