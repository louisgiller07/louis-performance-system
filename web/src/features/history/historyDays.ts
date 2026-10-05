import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import { hasActiveSafetyRule } from "../dailyPlan/safetyPresentation";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import type { CheckinRow } from "../checkin/checkinTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { dayCompletion, type GuidedCompletion } from "../completion/dayCompletion";
import type { RaceOverlayEvent } from "../planning/raceOverlayRepo";
import { weekDates } from "../today/todayContext";
import type { DecisionHistoryRow } from "./historyTypes";

// UX-07 — History as the rider's journey. Pure presentation of rows that
// already exist: decisions grouped into days, the day's check-in, recorded
// session and race. Nothing here decides, scores or re-computes anything:
// - several decisions on one day (append-only) → one day whose outcome is
//   the latest valid decision (the one the athlete saw last); the others
//   stay reachable as re-evaluations;
// - "planned" is what the Head Coach had in front of it when deciding
//   (planned_session_before), never today's version of the plan;
// - the journey facts are plain counts of those days.

export interface HistoryDay {
  date: string;
  /** Latest valid decision of the day, else the latest row (legacy / malformed: shown degraded). */
  main: DecisionHistoryRow;
  dailyPlan: DailyPlan | null;
  /** Every decision of the day, oldest first (length > 1 → "Journée réévaluée"). */
  decisions: DecisionHistoryRow[];
  checkin: CheckinRow | null;
  completed: CompletedSessionRecord | null;
  /**
   * UX-11R.9 (F-5) — the day's completed guided V2 session, set only when it is
   * what makes the day done (no legacy non-skipped row: dayCompletion.ts).
   */
  guided: GuidedCompletion | null;
  race: RaceOverlayEvent | null;
}

export type DayOutcome =
  | { kind: "adapted" } // a planned session was changed by NALYNT
  | { kind: "kept" } // the planned session was kept
  | { kind: "unplanned" } // no session was planned that day
  | { kind: "unknown" }; // legacy decision, not readable

export function dayOutcome(day: Pick<HistoryDay, "dailyPlan">): DayOutcome {
  const plan = day.dailyPlan;
  if (!plan) return { kind: "unknown" };
  if (plan.planned_session_before === null) return { kind: "unplanned" };
  return plan.decision === "KEEP" ? { kind: "kept" } : { kind: "adapted" };
}

/** The day's health state as the engine recorded it with the decision (same semantics as HistoryDetail). */
export function hasHealthSignal(day: Pick<HistoryDay, "dailyPlan">): boolean {
  return day.dailyPlan?.health_flag_to_create !== undefined;
}

/** A rest decided by a safety rule (layer A). */
export function isSafetyRest(day: Pick<HistoryDay, "dailyPlan">): boolean {
  return day.dailyPlan !== null && day.dailyPlan.decision === "REST" && hasActiveSafetyRule(day.dailyPlan);
}

export function buildHistoryDays(
  rows: DecisionHistoryRow[],
  checkins: CheckinRow[],
  completed: CompletedSessionRecord[],
  races: RaceOverlayEvent[],
  guided: readonly GuidedCompletion[] = []
): HistoryDay[] {
  const byDate = new Map<string, DecisionHistoryRow[]>();
  for (const row of rows) byDate.set(row.decisionDate, [...(byDate.get(row.decisionDate) ?? []), row]);

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayRows]) => {
      const chronological = dayRows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const newestFirst = chronological.slice().reverse();
      const main = newestFirst.find((row) => isValidDailyPlan(row.dailyPlan)) ?? newestFirst[0]!;
      const done = dayCompletion(date, completed, guided);
      return {
        date,
        main,
        dailyPlan: isValidDailyPlan(main.dailyPlan) ? main.dailyPlan : null,
        decisions: chronological,
        checkin: checkins.find((checkin) => checkin.checkin_date === date) ?? null,
        completed: completed.find((session) => session.session_date === date) ?? null,
        guided: done?.source === "guided" ? done.guided : null,
        race: races.find((race) => race.startDate <= date && date <= race.endDate) ?? null,
      };
    });
}

export interface HistoryMonth {
  /** "2026-09" */
  key: string;
  days: HistoryDay[];
}

export interface HistoryZones {
  today: HistoryDay | null;
  /** This calendar week (Monday → Sunday) before today, newest first. */
  week: HistoryDay[];
  /** Everything before this Monday, by month, newest first. */
  older: HistoryMonth[];
}

export function historyZones(days: HistoryDay[], today: string): HistoryZones {
  const monday = weekDates(today)[0]!;
  const older: HistoryMonth[] = [];
  for (const day of days.filter((d) => d.date < monday)) {
    const key = day.date.slice(0, 7);
    const month = older.find((m) => m.key === key);
    if (month) month.days.push(day);
    else older.push({ key, days: [day] });
  }
  return {
    today: days.find((day) => day.date === today) ?? null,
    week: days.filter((day) => monday <= day.date && day.date < today),
    older,
  };
}

export interface JourneyFacts {
  since: string;
  analysedDays: number;
  adaptations: number;
  safetyRests: number;
  recordedSessions: number;
  unrecordedSessions: number;
}

/** Plain counts over the loaded days — no score, no percentage, no trend. Null when there is nothing yet. */
export function journeyFacts(days: HistoryDay[], today: string): JourneyFacts | null {
  if (days.length === 0) return null;
  return {
    since: days[days.length - 1]!.date,
    analysedDays: days.length,
    adaptations: days.filter((day) => dayOutcome(day).kind === "adapted" && !isSafetyRest(day)).length,
    safetyRests: days.filter(isSafetyRest).length,
    recordedSessions: days.filter((day) => day.completed !== null || day.guided !== null).length,
    unrecordedSessions: days.filter((day) => day.date < today && day.completed === null && day.guided === null && day.dailyPlan?.planned_session_before != null).length,
  };
}
