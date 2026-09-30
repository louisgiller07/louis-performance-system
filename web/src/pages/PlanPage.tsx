import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";
import { SubPageLink } from "../components/SubPageLink";
import { AppHeader } from "../components/AppHeader";
import { StateCard, StateSkeleton } from "../components/StateCard";
import { addDays } from "../lib/date";
import { useEffectiveToday } from "../lib/simulationClock";
import { PlanningDayCard } from "../features/planning/PlanningDayCard";
import { loadPlannedSessions } from "../features/planning/planningRepo";
import { loadRacesInRange, groupRacesByDate } from "../features/planning/raceOverlayRepo";
import type { PlannedSessionRow } from "../features/planning/planningTypes";
import type { RaceOverlayEvent } from "../features/planning/raceOverlayRepo";
import { getActivePlanVersionId, getTrainingPlanReview } from "../features/trainingPlanReview/trainingPlanReviewRepo";
import { PAGE, planSessionsByDate } from "../features/planning/weekPresentation";
import type { PlanDaySession } from "../features/planning/weekPresentation";

type LoadState = "loading" | "loaded" | "error";
// NAL-007 — entirely separate from LoadState above: a race-read failure
// must never block planned_sessions from loading/being usable, and vice
// versa. "error" here only ever suppresses the race overlay, never the
// planning editor itself.
type RaceLoadState = "loading" | "loaded" | "error";
// UX-10B-2B — the active plan, read only to tell "Prévue par ton plan" from
// "Libre" truthfully (a plan day the projection has not written yet is
// still a plan day). Independent too: a plan-read failure never blocks the
// week, it only withholds the "Libre" / "Revenir au plan" claims.
type PlanLoadState = "loading" | "loaded" | "error";

const HORIZON_DAYS = 7;

/**
 * /plan — "Modifier ma semaine" (UX-10B-2B), the athlete's rolling 7-day
 * manual Planning workflow (V0.3_003C).
 * PlanPage is the sole in-memory source of truth for what is persisted for
 * each of the seven dates; PlanningDayCard only ever reads it via props and
 * reports mutations back through onRowChange. No persistent cache, no
 * context above the route, no localStorage — route remount is the
 * freshness mechanism (locked V0.3_003A).
 */
export function PlanPage() {
  const { athleteId } = useAuth();
  // V0.3.010 (SIM-001) — real date for any real athlete (identical to the
  // pre-V0.3.010 `todayLocal()` behavior); only the configured simulation
  // athlete gets a simulated reference date (src/lib/simulationClock.ts) —
  // this is what previously made Planning "artificially non-planifié" past
  // simulated day 7, since this page called `todayLocal()` directly and had
  // no idea a simulation was running.
  const effectiveToday = useEffectiveToday();

  const dates = useMemo(() => {
    return Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(effectiveToday, i));
  }, [effectiveToday]);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Record<string, PlannedSessionRow | null>>({});
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // NAL-007 — race/event overlay state, loaded and errored independently of
  // planned_sessions above. Read-only: race_calendar is never written here.
  const [raceLoadState, setRaceLoadState] = useState<RaceLoadState>("loading");
  const [racesByDate, setRacesByDate] = useState<Record<string, RaceOverlayEvent[]>>({});

  const [planLoadState, setPlanLoadState] = useState<PlanLoadState>("loading");
  const [planByDate, setPlanByDate] = useState<Record<string, PlanDaySession>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});

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
    // `dates` is intentionally not a dependency: per the existing
    // architecture (V0.3_003A), route remount is the only freshness
    // mechanism for this page — a live date change without navigating away
    // and back (real "today" rolling over past midnight, or the simulation
    // clock advancing while /plan stays mounted) is not expected to
    // re-fetch on its own, same contract as before V0.3.010.
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

  const loadPlan = useCallback(async () => {
    if (!athleteId) return;
    setPlanLoadState("loading");
    try {
      const planVersionId = await getActivePlanVersionId();
      if (!planVersionId) {
        setPlanByDate({});
      } else {
        const review = await getTrainingPlanReview(planVersionId);
        const sessions = review.blocks.flatMap((block) => block.weeks.flatMap((week) => week.sessions));
        setPlanByDate(planSessionsByDate(sessions, dates));
      }
      setPlanLoadState("loaded");
    } catch {
      setPlanLoadState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    void loadRaces();
  }, [loadRaces]);

  function handleToggleExpand(date: string) {
    setExpandedDate((current) => (current === date ? null : date));
  }

  function handleRowChange(date: string, row: PlannedSessionRow | null, notice?: string) {
    setRows((prev) => ({ ...prev, [date]: row }));
    // Only collapse the day that actually produced this mutation — if the
    // athlete already switched to a different day while this one's
    // save/delete was still in flight, that other day must stay open.
    setExpandedDate((current) => (current === date ? null : current));
    setNotices((prev) => {
      const next = { ...prev };
      if (notice) next[date] = notice;
      else delete next[date];
      return next;
    });
  }

  const ready = loadState === "loaded" && planLoadState !== "loading";

  return (
    <PageShell header={<AppHeader />}>
      <SubPageLink to="/training-plan" label={PAGE.back} back />
      <section className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold uppercase leading-none text-ink">{PAGE.title}</h1>
        <p className="text-base text-ink/85">{PAGE.subtitle}</p>
        <p className="text-sm text-muted">{PAGE.role}</p>
      </section>

      {!athleteId && (
        <StateCard tone="error" title="Profil introuvable">
          Nous n'avons pas réussi à retrouver ton profil. Contacte le support si le problème continue.
        </StateCard>
      )}

      {athleteId && loadState !== "error" && !ready && <StateSkeleton blocks={[22, 22, 22, 22]} />}

      {athleteId && loadState === "error" && (
        <StateCard tone="error" title={PAGE.loadErrorTitle} action={{ label: PAGE.retry, onClick: () => void load() }}>
          {PAGE.loadError}
        </StateCard>
      )}

      {athleteId && ready && planLoadState === "error" && <p className="text-xs text-muted">{PAGE.planUnavailable}</p>}

      {athleteId && ready && raceLoadState === "error" && <p className="text-xs text-muted">{PAGE.racesUnavailable}</p>}

      {athleteId && ready && (
        <div className="flex flex-col gap-2">
          {dates.map((date, index) => (
            <PlanningDayCard
              key={date}
              athleteId={athleteId}
              date={date}
              row={rows[date] ?? null}
              planSession={planByDate[date] ?? null}
              planKnown={planLoadState === "loaded"}
              notice={notices[date] ?? null}
              races={racesByDate[date] ?? []}
              isToday={index === 0}
              isExpanded={expandedDate === date}
              onToggleExpand={() => handleToggleExpand(date)}
              onRowChange={handleRowChange}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
