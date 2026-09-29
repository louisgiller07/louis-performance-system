import { useEffect, useState } from "react";
import { addDays } from "../../lib/date";
import { loadRaces, loadObjective } from "../today/todayContextRepo";
import type { TodayRace } from "../today/todayContext";
import { loadCompletedSessionsForDates, loadDecisionHistory } from "../history/historyRepo";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import { latestDecisionByDate, planSessions } from "./programPresentation";

// UX-06 — read-only facts Programme shows around the plan: the race /
// objective (same reads as Today, UX-04/05), completed sessions on the
// plan's days up to today, and the Head Coach decisions of those days (for
// "adaptée" on today / past days only). All RLS-scoped, existing tables and
// columns, no write. Best-effort: any failed read only hides its own
// element — the plan itself always renders.

export interface ProgramContext {
  races: TodayRace[];
  objective: string | null;
  completed: CompletedSessionRecord[];
  decisionsByDate: Map<string, DailyPlan>;
}

const EMPTY: ProgramContext = { races: [], objective: null, completed: [], decisionsByDate: new Map() };
/** Decisions read to cover the plan's recent days (append-only: a few per day at most). */
const DECISION_LOOKBACK = 90;

function valueOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export async function loadProgramContext(athleteId: string, review: TrainingPlanReview, today: string): Promise<ProgramContext> {
  const planDates = [...new Set(planSessions(review).map((session) => session.date).filter((date) => date <= today))];
  const [races, objective, completed, decisions] = await Promise.allSettled([
    loadRaces(athleteId, today, addDays(today, 366)),
    loadObjective(),
    planDates.length > 0 ? loadCompletedSessionsForDates(athleteId, planDates) : Promise.resolve([]),
    loadDecisionHistory(athleteId, DECISION_LOOKBACK),
  ]);
  return {
    races: valueOr(races, []),
    objective: valueOr(objective, null),
    completed: valueOr(completed, []),
    decisionsByDate: latestDecisionByDate(valueOr(decisions, [])),
  };
}

/** `null` while loading or without an athlete. */
export function useProgramContext(athleteId: string | null | undefined, review: TrainingPlanReview | null, today: string): ProgramContext | null {
  const [context, setContext] = useState<ProgramContext | null>(null);

  useEffect(() => {
    if (!athleteId || !review) return;
    let active = true;
    loadProgramContext(athleteId, review, today)
      .then((loaded) => {
        if (active) setContext(loaded);
      })
      .catch(() => {
        if (active) setContext(EMPTY);
      });
    return () => {
      active = false;
    };
  }, [athleteId, review, today]);

  return context;
}
