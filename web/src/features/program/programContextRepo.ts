import { useEffect, useState } from "react";
import { addDays } from "../../lib/date";
import { loadRaces, loadObjective } from "../today/todayContextRepo";
import type { TodayRace } from "../today/todayContext";
import { loadEffectiveSources } from "../effectiveSession/effectiveSessionRepo";
import { effectiveDays, type EffectiveDay, type EffectiveSources, type PlannedDaySession } from "../effectiveSession/effectiveDay";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { TrainingInterventionKind } from "../dailyPlan/dailyPlanTypes";
import type { GuidedCompletion } from "../completion/dayCompletion";
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
  /** UX-11R.9 — guided V2 executions completed on the plan's days (dayCompletion.ts). */
  guided: GuidedCompletion[];
  decisionsByDate: Map<string, DailyPlan>;
  /** A07 — the effective session of each plan day up to today (shared read model). */
  effectiveByDate: Map<string, EffectiveDay>;
}

const EMPTY: ProgramContext = { races: [], objective: null, completed: [], guided: [], decisionsByDate: new Map(), effectiveByDate: new Map() };

/**
 * A07 — the decision each plan day is about: the effective one (a completed
 * execution's own decision stays authoritative over a newer one, R9-UI-01),
 * else the day's latest valid decision.
 */
function effectiveDecisionByDate(dates: readonly string[], sources: EffectiveSources): Map<string, DailyPlan> {
  const latest = latestDecisionByDate([...sources.decisions]);
  const map = new Map<string, DailyPlan>();
  for (const day of effectiveDays(dates, sources)) {
    const own = day.decisionId ? sources.decisions.find((d) => d.id === day.decisionId && isValidDailyPlan(d.dailyPlan)) : undefined;
    const plan = (own?.dailyPlan as DailyPlan | undefined) ?? latest.get(day.date);
    if (plan) map.set(day.date, plan);
  }
  return map;
}

/** The plan's sessions as the effective-session read model takes them. */
function plannedDaySessions(review: TrainingPlanReview): PlannedDaySession[] {
  return planSessions(review).map((s) => ({
    date: s.date,
    session: {
      kind: s.kind as TrainingInterventionKind,
      ...(s.loadProfile === "LIGHT" || s.loadProfile === "MODERATE" || s.loadProfile === "HEAVY" ? { load_profile: s.loadProfile } : {}),
      ...(s.durationMin !== null ? { duration_min: s.durationMin } : {}),
    },
  }));
}

function valueOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export async function loadProgramContext(athleteId: string, review: TrainingPlanReview, today: string): Promise<ProgramContext> {
  const planDates = [...new Set(planSessions(review).map((session) => session.date).filter((date) => date <= today))];
  const [races, objective, sources] = await Promise.allSettled([
    loadRaces(athleteId, today, addDays(today, 366)),
    loadObjective(),
    // A07 — one read model for the plan's days up to today: decisions, executions, legacy debriefs.
    loadEffectiveSources(athleteId, planDates, plannedDaySessions(review)),
  ]);
  const loaded = sources.status === "fulfilled" ? sources.value : null;
  return {
    races: valueOr(races, []),
    objective: valueOr(objective, null),
    completed: loaded ? [...loaded.legacy] : [],
    guided: loaded
      ? loaded.executions
          .filter((e) => e.events.includes("completed") && e.decisionId !== null)
          .map((e) => ({ executionId: e.executionId, sessionDate: e.sessionDate, decisionId: e.decisionId!, finalPrescriptionId: e.finalPrescriptionId }))
      : [],
    decisionsByDate: loaded ? effectiveDecisionByDate(planDates, loaded) : new Map(),
    effectiveByDate: new Map(loaded ? effectiveDays(planDates, loaded).map((d) => [d.date, d] as const) : []),
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
