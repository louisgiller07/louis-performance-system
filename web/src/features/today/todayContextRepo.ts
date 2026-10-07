import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { addDays } from "../../lib/date";
import type { RacePriority } from "../planning/raceOverlayRepo";
import { loadPlannedSessions } from "../planning/planningRepo";
import type { PlannedSessionRow } from "../planning/planningTypes";
import { loadEffectiveSources } from "../effectiveSession/effectiveSessionRepo";
import { effectiveDays, type EffectiveDay, type EffectiveSources, type PlannedDaySession } from "../effectiveSession/effectiveDay";
import type { GuidedCompletion } from "../completion/dayCompletion";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { loadPerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import { loadOnboardingAnswers } from "../athleteOnboarding/athleteOnboardingRepo";
import { PRIMARY_GOAL_LABELS } from "../athleteOnboarding/onboardingCopy";
import { firstNameFrom, weekDates, type TodayRace } from "./todayContext";

// UX-04 / UX-05 — read-only loading of Today's coach context. Every read is
// RLS-scoped to the athlete's own rows and reads existing columns only:
// - reused as-is: planned / completed sessions, performance setup,
//   onboarding answers;
// - Today-specific selects on existing tables: athletes.name (UX-04),
//   race_calendar with its existing location / race_format columns (same
//   filters as raceOverlayRepo.loadRacesInRange, which Semaine keeps using
//   unchanged), and this week's daily_checkins dates (UX-05 regularity).
// Best-effort: a failed read only hides its own element, it never blocks
// Today's check-in / decision flow.

export interface TodayContext {
  firstName: string | null;
  races: TodayRace[];
  /** Season objective (free text) if set, else the onboarding primary goal label. */
  objective: string | null;
  planned: PlannedSessionRow[];
  completed: CompletedSessionRecord[];
  /** UX-11R.9 — this week's guided V2 executions that reached `completed` (dayCompletion.ts). */
  guided: GuidedCompletion[];
  /** A07 — this week's effective sessions (shared read model); null when the week's decisions / executions could not be read. */
  effective: EffectiveDay[] | null;
  /** Dates (YYYY-MM-DD) of this week's saved check-ins, Monday → today. */
  checkinDates: string[];
}

const EMPTY: TodayContext = { firstName: null, races: [], objective: null, planned: [], completed: [], guided: [], effective: null, checkinDates: [] };

/** A planned_sessions row as the effective-session read model takes it (a legacy coarse row without intervention stays plan-only). */
function plannedDaySessions(rows: readonly PlannedSessionRow[]): PlannedDaySession[] {
  return rows.flatMap((row) => (row.intervention ? [{ date: row.planned_date, session: row.intervention }] : []));
}

/** Completed guided executions, from the same execution rows as the read model (UX-11R.9 dayCompletion.ts shape). */
function guidedCompletions(sources: EffectiveSources): GuidedCompletion[] {
  return sources.executions
    .filter((e) => e.events.includes("completed") && e.decisionId !== null)
    .map((e) => ({ executionId: e.executionId, sessionDate: e.sessionDate, decisionId: e.decisionId!, finalPrescriptionId: e.finalPrescriptionId }));
}

/** Days ahead scanned for the next planned session ("Prochaine étape"). */
const NEXT_SESSION_LOOKAHEAD_DAYS = 14;
/** Races beyond a year are never displayed (validated rule), so never fetched. */
const RACE_LOOKAHEAD_DAYS = 366;
/** Same "active" statuses as raceOverlayRepo (Semaine). */
const ACTIVE_RACE_STATUSES = ["planned", "registered", "confirmed"] as const;

/** Also used by the first run (UX-09). */
export async function loadFirstName(): Promise<string | null> {
  const { data, error } = await supabase.from("athletes").select("name");
  if (error || !data || data.length !== 1) return null;
  return firstNameFrom((data[0] as { name: string | null }).name);
}

interface RaceRow {
  event_name: string;
  start_date: string;
  end_date: string;
  priority: RacePriority;
  location: string | null;
  race_format: string | null;
}

/** Also used by Programme (UX-06). */
export async function loadRaces(athleteId: string, fromDate: string, toDate: string): Promise<TodayRace[]> {
  const { data, error } = await supabase
    .from("race_calendar")
    .select("event_name, start_date, end_date, priority, location, race_format")
    .eq("athlete_id", athleteId)
    .in("status", ACTIVE_RACE_STATUSES)
    .lte("start_date", toDate)
    .gte("end_date", fromDate);
  if (error) throw new Error("today races unavailable");
  return ((data ?? []) as RaceRow[]).map((row) => ({
    eventName: row.event_name,
    startDate: row.start_date,
    endDate: row.end_date,
    priority: row.priority,
    location: row.location?.trim() || null,
    raceFormat: row.race_format,
  }));
}

async function loadCheckinDates(athleteId: string, fromDate: string, toDate: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("daily_checkins")
    .select("checkin_date")
    .eq("athlete_id", athleteId)
    .gte("checkin_date", fromDate)
    .lte("checkin_date", toDate);
  if (error) throw new Error("today check-in dates unavailable");
  return ((data ?? []) as { checkin_date: string }[]).map((row) => row.checkin_date);
}

/** Also used by Programme (UX-06). */
export async function loadObjective(): Promise<string | null> {
  const [setup, onboarding] = await Promise.allSettled([loadPerformanceSetupAnswers(), loadOnboardingAnswers()]);
  const seasonObjective = setup.status === "fulfilled" ? setup.value.seasonObjective?.trim() : undefined;
  if (seasonObjective) return seasonObjective;
  const primaryGoal = onboarding.status === "fulfilled" ? onboarding.value.primaryGoal : null;
  return primaryGoal ? PRIMARY_GOAL_LABELS[primaryGoal] : null;
}

function valueOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export async function loadTodayContext(athleteId: string, today: string): Promise<TodayContext> {
  const week = weekDates(today);
  const lastDate = [week[6]!, addDays(today, NEXT_SESSION_LOOKAHEAD_DAYS)].sort().at(-1)!;
  const plannedLoad = loadPlannedSessions(athleteId, week[0]!, lastDate);
  // A07 — one read model for the week: decisions, executions and legacy debriefs (the completed / guided lists derive from it).
  const sourcesLoad = plannedLoad.catch(() => [] as PlannedSessionRow[]).then((rows) => loadEffectiveSources(athleteId, week, plannedDaySessions(rows)));
  const [firstName, races, objective, planned, sources, checkinDates] = await Promise.allSettled([
    loadFirstName(),
    loadRaces(athleteId, week[0]!, addDays(today, RACE_LOOKAHEAD_DAYS)),
    loadObjective(),
    plannedLoad,
    sourcesLoad,
    loadCheckinDates(athleteId, week[0]!, today),
  ]);
  const loadedSources = sources.status === "fulfilled" ? sources.value : null;
  return {
    firstName: valueOr(firstName, null),
    races: valueOr(races, []),
    objective: valueOr(objective, null),
    planned: valueOr(planned, []),
    completed: loadedSources ? [...loadedSources.legacy] : [],
    guided: loadedSources ? guidedCompletions(loadedSources) : [],
    effective: loadedSources ? effectiveDays(week, loadedSources) : null,
    checkinDates: valueOr(checkinDates, []),
  };
}

/** `null` while loading. `refreshKey` reloads (e.g. after a session is logged). */
export function useTodayContext(athleteId: string | null, today: string, refreshKey = 0): TodayContext | null {
  const [context, setContext] = useState<TodayContext | null>(null);

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    loadTodayContext(athleteId, today)
      .then((loaded) => {
        if (active) setContext(loaded);
      })
      .catch(() => {
        if (active) setContext(EMPTY);
      });
    return () => {
      active = false;
    };
  }, [athleteId, today, refreshKey]);

  return context;
}
