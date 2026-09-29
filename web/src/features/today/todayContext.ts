import { addDays } from "../../lib/date";
import type { RaceOverlayEvent } from "../planning/raceOverlayRepo";
import type { PlannedSessionRow } from "../planning/planningTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { TrainingInterventionKind } from "../dailyPlan/dailyPlanTypes";

// UX-04 — Today's coach context (greeting, race / objective, week).
// Pure presentation and calendar formatting only: no sporting computation,
// no score. Every value comes from rows the athlete (or their accepted plan)
// already has.

/** "Louis Giller" → "Louis"; nothing usable → null (the caller shows the brand instead). */
export function firstNameFrom(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD), timezone-safe. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000);
}

export type RaceHorizon =
  | { kind: "ongoing"; race: RaceOverlayEvent; day: number }
  | { kind: "countdown"; race: RaceOverlayEvent; days: number }
  | { kind: "horizon"; race: RaceOverlayEvent; days: number };

/**
 * Validated display rule (UX-04): a race in progress is shown as such; the
 * next race under 120 days as "J-XX"; between 120 and 365 days as "Prochain
 * objectif"; beyond 365 days (or none) nothing — the objective is shown instead.
 */
export function raceHorizon(races: RaceOverlayEvent[], today: string): RaceHorizon | null {
  const ongoing = races
    .filter((race) => race.startDate <= today && today <= race.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (ongoing) return { kind: "ongoing", race: ongoing, day: daysBetween(ongoing.startDate, today) + 1 };

  const next = races.filter((race) => race.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!next) return null;
  const days = daysBetween(today, next.startDate);
  if (days < 120) return { kind: "countdown", race: next, days };
  if (days <= 365) return { kind: "horizon", race: next, days };
  return null;
}

/** Monday → Sunday of the week containing `today`. */
export function weekDates(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  const monday = addDays(today, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

const SHORT_KIND_LABELS: Record<TrainingInterventionKind, string> = {
  STRENGTH_LOWER: "Force",
  STRENGTH_UPPER: "Force",
  STRENGTH_FULL_LIGHT: "Force",
  POWER: "Force",
  GRIP_WORK: "Grip",
  AEROBIC_BASE: "Aéro",
  AEROBIC_INTERVALS: "Aéro",
  DH_TECHNICAL: "DH",
  DH_PERFORMANCE: "DH",
  DH_LIGHT: "DH",
  PUMPTRACK: "Pump",
  MOBILITY: "Mobi",
  RECOVERY_ACTIVE: "Récup",
  REST: "Repos",
  BIKE_MAINTENANCE: "Méca",
  RACE_ACTIVITY: "Course",
};

export interface WeekDay {
  date: string;
  isToday: boolean;
  isPast: boolean;
  /** Short label of the planned session, if any ("DH", "Force", …). */
  planned: string | null;
  /** A session was actually performed (done / partial / replaced) — "skipped" does not count. */
  performed: boolean;
  race: string | null;
}

export interface WeekSummary {
  days: WeekDay[];
  plannedCount: number;
  performedCount: number;
}

function isTrainingSession(row: PlannedSessionRow): boolean {
  return row.intervention ? row.intervention.kind !== "REST" : row.session_type !== "REST";
}

export function weekSummary(
  today: string,
  planned: PlannedSessionRow[],
  completed: CompletedSessionRecord[],
  races: RaceOverlayEvent[]
): WeekSummary {
  const dates = weekDates(today);
  const days = dates.map((date) => {
    const row = planned.find((candidate) => candidate.planned_date === date);
    const performed = completed.some((session) => session.session_date === date && session.completion_status !== "skipped");
    const race = races.find((event) => event.startDate <= date && date <= event.endDate);
    return {
      date,
      isToday: date === today,
      isPast: date < today,
      planned: row ? (row.intervention ? (SHORT_KIND_LABELS[row.intervention.kind] ?? "Séance") : "Séance") : null,
      performed,
      race: race ? race.eventName : null,
    };
  });
  const inWeek = planned.filter((row) => dates.includes(row.planned_date));
  return {
    days,
    plannedCount: inWeek.filter(isTrainingSession).length,
    performedCount: days.filter((day) => day.performed).length,
  };
}

/** The next planned training session strictly after today, if any. */
export function nextPlannedSession(planned: PlannedSessionRow[], today: string): PlannedSessionRow | null {
  return (
    planned
      .filter((row) => row.planned_date > today && isTrainingSession(row))
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date))[0] ?? null
  );
}
