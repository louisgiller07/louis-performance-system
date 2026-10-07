import type { EffectiveDay } from "../effectiveSession/effectiveDay";
import { strengthSummary } from "../finalPrescriptionV2/strengthSummary";
import type { TrainingPlanReview, TrainingPlanReviewSession, TrainingPlanReviewWeek } from "../trainingPlanReview/trainingPlanReviewTypes";
import { dayCompletion, isDayDone, type GuidedCompletion } from "../completion/dayCompletion";
import type { CompletedSessionRecord, CompletionStatus } from "../completedSession/completedSessionTypes";
import type { DecisionHistoryRow } from "../history/historyTypes";
import type { DailyPlan, TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import type { RaceOverlayEvent } from "../planning/raceOverlayRepo";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import { coachWhy } from "../dailyPlan/coachInsights";
import { translateTrainingKind, translateWeekType, UNKNOWN_SESSION_LABEL } from "../trainingLabels/trainingLabels";
import { translateDrill, translateExercise } from "../trainingLabels/exerciseLabels";
import { addDays } from "../../lib/date";
import { weekDates, type WeekDay } from "../today/todayContext";

// UX-06 — Programme presentation helpers. Pure formatting of the accepted
// (or reviewed) plan version plus facts that already exist elsewhere
// (completed sessions, the day's Head Coach decision, races). Nothing here
// plans, scores or re-decides anything:
// - "Focus" is the first exercise / drill of the stored prescription, shown
//   only when it has a known French label — never an invented objective;
// - an adaptation exists only for today and past days, where the Head Coach
//   actually decided (decisions.daily_plan); a future session is "prévue";
// - the plan phase is the stored week type; "Semaine N / M" is the week's
//   position among the plan's own weeks.

export function planSessions(review: TrainingPlanReview): TrainingPlanReviewSession[] {
  return review.blocks
    .flatMap((block) => block.weeks)
    .flatMap((week) => week.sessions)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function sessionOn(review: TrainingPlanReview, date: string): TrainingPlanReviewSession | null {
  return planSessions(review).find((session) => session.date === date) ?? null;
}

export function sessionTitle(session: Pick<TrainingPlanReviewSession, "kind">): string {
  return translateTrainingKind(session.kind) ?? UNKNOWN_SESSION_LABEL;
}

/** First exercise / drill of the stored prescription, when its French name is known; otherwise null (the line is hidden). A prescription format this app cannot read (UX-11A.5b.1) has no focus; the session card itself says so. */
export function sessionFocus(session: Pick<TrainingPlanReviewSession, "prescription">): string | null {
  if (session.prescription?.status !== "supported") return null;
  // A02 — V2: the first work exercise of a Force session, or the main drill of a DH session.
  if (session.prescription.schemaVersion === "v2") {
    const view = session.prescription.prescription;
    const summary = strengthSummary(view);
    if (summary) return summary.workExercises[0]?.name ?? null;
    const drill = view.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill");
    return drill?.name ?? null;
  }
  const structure = session.prescription.prescription.structure;
  if (typeof structure !== "object" || structure === null) return null;
  const record = structure as Record<string, unknown>;
  if (record.domain === "dh_technical" && Array.isArray(record.drills)) {
    const first = record.drills[0] as Record<string, unknown> | undefined;
    return first ? translateDrill(first.drillId) : null;
  }
  if (record.domain === "strength" && Array.isArray(record.blocks)) {
    const first = record.blocks[0] as Record<string, unknown> | undefined;
    return first ? translateExercise(first.exerciseId) : null;
  }
  return null;
}

export interface PlanWeekPosition {
  week: TrainingPlanReviewWeek;
  /** 1-based position among the plan's own weeks. */
  position: number;
  total: number;
  /** French week type ("Affûtage", …); null when unknown. */
  phase: string | null;
}

export function planWeekAt(review: TrainingPlanReview, date: string): PlanWeekPosition | null {
  const weeks = review.blocks.flatMap((block) => block.weeks).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const index = weeks.findIndex((week) => week.startDate <= date && date <= week.endDate);
  if (index < 0) return null;
  return { week: weeks[index]!, position: index + 1, total: weeks.length, phase: translateWeekType(weeks[index]!.weekType) };
}

/** Mondays of every calendar week (Monday → Sunday) overlapping the plan horizon. */
export function calendarMondays(review: TrainingPlanReview): string[] {
  const first = weekDates(review.version.horizonStartDate)[0]!;
  const last = weekDates(review.version.horizonEndDate)[0]!;
  const mondays: string[] = [];
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) mondays.push(monday);
  return mondays;
}

/** The week to open on: the one containing today, else the closest end of the plan. */
export function initialMonday(mondays: string[], today: string): string {
  const current = weekDates(today)[0]!;
  if (mondays.includes(current)) return current;
  return current < mondays[0]! ? mondays[0]! : mondays[mondays.length - 1]!;
}

function performedOn(date: string, completed: CompletedSessionRecord[], guided: readonly GuidedCompletion[]): boolean {
  // UX-11R.9 — the shared "day done" rule (Today, Programme, History).
  return isDayDone(date, completed, guided);
}

/** One calendar week of the plan, in the shared WeekDay shape (Today's strip language). */
export function programWeekDays(
  monday: string,
  today: string,
  review: TrainingPlanReview,
  completed: CompletedSessionRecord[],
  races: RaceOverlayEvent[],
  guided: readonly GuidedCompletion[] = [],
  effectiveByDate: ReadonlyMap<string, EffectiveDay> = new Map()
): WeekDay[] {
  return weekDates(monday).map((date) => {
    const session = sessionOn(review, date);
    const race = races.find((event) => event.startDate <= date && date <= event.endDate);
    // A07 — a decided / executed day shows its effective session (a REPLACE as its replacement, a REST as rest).
    const effective = effectiveByDate.get(date);
    if (effective && effective.source !== "planned" && effective.source !== "none" && effective.session) {
      const label = sessionTitle({ kind: effective.session.kind });
      return {
        date,
        isToday: date === today,
        isPast: date < today,
        planned: label,
        plannedLabel: label,
        plannedDurationMin: effective.session.duration_min ?? null,
        performed: effective.status === "completed",
        adapted: effective.adaptation !== null,
        race: race ? race.eventName : null,
      };
    }
    return {
      date,
      isToday: date === today,
      isPast: date < today,
      planned: session ? sessionTitle(session) : null,
      plannedLabel: session ? sessionTitle(session) : null,
      plannedDurationMin: session?.durationMin ?? null,
      performed: performedOn(date, completed, guided),
      race: race ? race.eventName : null,
    };
  });
}

export interface ProgramTimeline {
  today: TrainingPlanReviewSession | null;
  upcoming: TrainingPlanReviewSession[];
  past: TrainingPlanReviewSession[];
}

export function splitByToday(review: TrainingPlanReview, today: string): ProgramTimeline {
  const sessions = planSessions(review);
  return {
    today: sessions.find((session) => session.date === today) ?? null,
    upcoming: sessions.filter((session) => session.date > today),
    past: sessions.filter((session) => session.date < today).reverse(),
  };
}

/**
 * The day's recorded completion, if any (most informative first: done, partial, replaced, skipped).
 * UX-11R.9 — a completed guided session reads as "done" when no legacy row says more (dayCompletion.ts).
 */
export function completionOn(date: string, completed: CompletedSessionRecord[], guided: readonly GuidedCompletion[] = []): CompletionStatus | null {
  const day = dayCompletion(date, completed, guided);
  if (day) return day.source === "legacy" ? day.status : "done";
  return completed.some((session) => session.session_date === date && session.completion_status === "skipped") ? "skipped" : null;
}

/** The latest valid Head Coach decision of each day (decisions are append-only; the latest is the one the athlete saw last). */
export function latestDecisionByDate(rows: DecisionHistoryRow[]): Map<string, DailyPlan> {
  const latest = new Map<string, DecisionHistoryRow>();
  for (const row of rows) {
    if (!isValidDailyPlan(row.dailyPlan)) continue;
    const current = latest.get(row.decisionDate);
    if (!current || row.createdAt > current.createdAt) latest.set(row.decisionDate, row);
  }
  return new Map([...latest].map(([date, row]) => [date, row.dailyPlan as DailyPlan]));
}

export interface Adaptation {
  planned: TrainingIntervention;
  adapted: TrainingIntervention;
  /** The same rider wording as Today's "Pourquoi ?" (coachInsights.ts). */
  why: string;
}

/** Only when the Head Coach did not KEEP a planned session — never computed for a future day. */
export function adaptationFrom(dailyPlan: DailyPlan | undefined): Adaptation | null {
  if (!dailyPlan || dailyPlan.decision === "KEEP" || dailyPlan.planned_session_before === null) return null;
  return { planned: dailyPlan.planned_session_before, adapted: dailyPlan.final_session, why: coachWhy(dailyPlan) };
}
