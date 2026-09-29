import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { addDays } from "../../lib/date";
import { loadRacesInRange, type RaceOverlayEvent } from "../planning/raceOverlayRepo";
import { loadPlannedSessions } from "../planning/planningRepo";
import type { PlannedSessionRow } from "../planning/planningTypes";
import { loadCompletedSessionsForDates } from "../history/historyRepo";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { loadPerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import { loadOnboardingAnswers } from "../athleteOnboarding/athleteOnboardingRepo";
import { PRIMARY_GOAL_LABELS } from "../athleteOnboarding/onboardingCopy";
import { firstNameFrom, weekDates } from "./todayContext";

// UX-04 — read-only loading of Today's coach context. Every read reuses an
// existing, RLS-scoped query (race calendar, planned / completed sessions,
// performance setup, onboarding answers); the one new read is the athlete's
// own `athletes.name` (RLS athletes_own_data — the same row AuthContext
// already resolves). Best-effort: a failed read only hides its own element,
// it never blocks Today's check-in / decision flow.

export interface TodayContext {
  firstName: string | null;
  races: RaceOverlayEvent[];
  /** Season objective (free text) if set, else the onboarding primary goal label. */
  objective: string | null;
  planned: PlannedSessionRow[];
  completed: CompletedSessionRecord[];
}

const EMPTY: TodayContext = { firstName: null, races: [], objective: null, planned: [], completed: [] };

/** Days ahead scanned for the next planned session ("Prochaine étape"). */
const NEXT_SESSION_LOOKAHEAD_DAYS = 14;
/** Races beyond a year are never displayed (validated rule), so never fetched. */
const RACE_LOOKAHEAD_DAYS = 366;

async function loadFirstName(): Promise<string | null> {
  const { data, error } = await supabase.from("athletes").select("name");
  if (error || !data || data.length !== 1) return null;
  return firstNameFrom((data[0] as { name: string | null }).name);
}

async function loadObjective(): Promise<string | null> {
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
  const [firstName, races, objective, planned, completed] = await Promise.allSettled([
    loadFirstName(),
    loadRacesInRange(athleteId, week[0]!, addDays(today, RACE_LOOKAHEAD_DAYS)),
    loadObjective(),
    loadPlannedSessions(athleteId, week[0]!, lastDate),
    loadCompletedSessionsForDates(athleteId, week),
  ]);
  return {
    firstName: valueOr(firstName, null),
    races: valueOr(races, []),
    objective: valueOr(objective, null),
    planned: valueOr(planned, []),
    completed: valueOr(completed, []),
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
