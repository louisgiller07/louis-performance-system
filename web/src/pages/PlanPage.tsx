import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AppNav } from "../components/AppNav";
import { addDays, todayLocal } from "../lib/date";
import { PlanningDayCard } from "../features/planning/PlanningDayCard";
import { loadPlannedSessions } from "../features/planning/planningRepo";
import { loadRacesInRange, groupRacesByDate } from "../features/planning/raceOverlayRepo";
import type { PlannedSessionRow } from "../features/planning/planningTypes";
import type { RaceOverlayEvent } from "../features/planning/raceOverlayRepo";

type LoadState = "loading" | "loaded" | "error";
// NAL-007 — entirely separate from LoadState above: a race-read failure
// must never block planned_sessions from loading/being usable, and vice
// versa. "error" here only ever suppresses the race overlay, never the
// planning editor itself.
type RaceLoadState = "loading" | "loaded" | "error";

const HORIZON_DAYS = 7;

/**
 * /plan — the athlete's rolling 7-day manual Planning workflow (V0.3_003C).
 * PlanPage is the sole in-memory source of truth for what is persisted for
 * each of the seven dates; PlanningDayCard only ever reads it via props and
 * reports mutations back through onRowChange. No persistent cache, no
 * context above the route, no localStorage — route remount is the
 * freshness mechanism (locked V0.3_003A).
 */
export function PlanPage() {
  const { user, athleteId, signOut } = useAuth();

  const dates = useMemo(() => {
    const today = todayLocal();
    return Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));
  }, []);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Record<string, PlannedSessionRow | null>>({});
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // NAL-007 — race/event overlay state, loaded and errored independently of
  // planned_sessions above. Read-only: race_calendar is never written here.
  const [raceLoadState, setRaceLoadState] = useState<RaceLoadState>("loading");
  const [racesByDate, setRacesByDate] = useState<Record<string, RaceOverlayEvent[]>>({});

  const load = useCallback(async () => {
    if (!athleteId) return;
    setLoadState("loading");
    try {
      const loaded = await loadPlannedSessions(athleteId, dates[0], dates[dates.length - 1]);
      const byDate = new Map(loaded.map((row) => [row.planned_date, row]));
      const next: Record<string, PlannedSessionRow | null> = {};
      for (const date of dates) {
        next[date] = byDate.get(date) ?? null;
      }
      setRows(next);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
    // dates is stable for the component's lifetime (computed once via useMemo with an empty dep array).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  const loadRaces = useCallback(async () => {
    if (!athleteId) return;
    setRaceLoadState("loading");
    try {
      const races = await loadRacesInRange(athleteId, dates[0], dates[dates.length - 1]);
      setRacesByDate(groupRacesByDate(races, dates));
      setRaceLoadState("loaded");
    } catch {
      // Deliberately no rows cleared/kept from a prior successful load —
      // the day cards simply stop showing race context on this failure;
      // planned_sessions (loadState above) is entirely unaffected.
      setRaceLoadState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadRaces();
  }, [loadRaces]);

  function handleToggleExpand(date: string) {
    setExpandedDate((current) => (current === date ? null : date));
  }

  function handleRowChange(date: string, row: PlannedSessionRow | null) {
    setRows((prev) => ({ ...prev, [date]: row }));
    // Only collapse the day that actually produced this mutation — if the
    // athlete already switched to a different day while this one's
    // save/delete was still in flight, that other day must stay open.
    setExpandedDate((current) => (current === date ? null : current));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
      <header className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-sm font-semibold text-gray-900">Louis Performance System</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-gray-400">{user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 active:bg-gray-100"
            >
              Déconnexion
            </button>
          </div>
        </div>
        <AppNav />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Planning</h1>
          <p className="text-sm text-gray-500">7 prochains jours</p>
        </div>

        {!athleteId && <p className="text-sm text-red-600">Erreur de configuration : aucun athlète résolu.</p>}

        {athleteId && loadState === "loading" && <p className="text-sm text-gray-500">Chargement…</p>}

        {athleteId && loadState === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-600">
              Impossible de charger le planning. Réessaie dans un instant.
            </p>
            <button type="button" onClick={() => void load()} className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
              Réessayer
            </button>
          </div>
        )}

        {athleteId && loadState === "loaded" && raceLoadState === "error" && (
          <p className="text-xs text-gray-400">Événements du calendrier de courses indisponibles pour l'instant.</p>
        )}

        {athleteId && loadState === "loaded" && (
          <div className="flex flex-col gap-2">
            {dates.map((date, index) => (
              <PlanningDayCard
                key={date}
                athleteId={athleteId}
                date={date}
                row={rows[date] ?? null}
                races={racesByDate[date] ?? []}
                isToday={index === 0}
                isExpanded={expandedDate === date}
                onToggleExpand={() => handleToggleExpand(date)}
                onRowChange={handleRowChange}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
