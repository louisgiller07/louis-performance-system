import { isTrainingDay, type EffectiveDay } from "../effectiveSession/effectiveDay";
import { addDays } from "../../lib/date";
import { isDayDone, type GuidedCompletion } from "../completion/dayCompletion";
import type { RaceOverlayEvent } from "../planning/raceOverlayRepo";
import type { PlannedSessionRow } from "../planning/planningTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { TrainingInterventionKind } from "../dailyPlan/dailyPlanTypes";
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";

// UX-04 / UX-05 — Today's coach context (greeting, race / objective, week,
// regularity). Pure presentation and calendar formatting only: no sporting
// computation, no score, no percentage. Every value comes from rows the
// athlete (or their accepted plan) already has.

/** A race as Today shows it: the overlay event plus the two descriptive columns race_calendar already has. */
export interface TodayRace extends RaceOverlayEvent {
  location: string | null;
  /** Raw race_format enum; translated at display time (trainingLabels/raceLabels.ts), never shown raw. */
  raceFormat: string | null;
}

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

export type RaceHorizon<R extends RaceOverlayEvent = RaceOverlayEvent> =
  | { kind: "ongoing"; race: R; day: number }
  | { kind: "countdown"; race: R; days: number }
  | { kind: "horizon"; race: R; days: number };

/**
 * Validated display rule (UX-04/05): a race in progress is shown as such;
 * the next race under 120 days as "Prochaine course · J-XX"; between 120 and
 * 365 days as "Objectif de saison"; beyond 365 days (or none) nothing — the
 * athlete's declared objective is shown instead, if one exists.
 */
export function raceHorizon<R extends RaceOverlayEvent>(races: R[], today: string): RaceHorizon<R> | null {
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
  /** Short label of the planned session, if any ("DH", "Force", …) — fits under the day. */
  planned: string | null;
  /** Full label of the planned session ("DH technique") — shown when the day is selected. */
  plannedLabel: string | null;
  plannedDurationMin: number | null;
  /** A session was actually performed (done / partial / replaced) — "skipped" does not count. */
  performed: boolean;
  /** A07 — the Head Coach adapted the planned session that day (MODIFY / REPLACE / REST); the labels above are the effective session. */
  adapted?: boolean;
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
  races: RaceOverlayEvent[],
  guided: readonly GuidedCompletion[] = [],
  effective: readonly EffectiveDay[] | null = null
): WeekSummary {
  const dates = weekDates(today);
  // A07 — with the effective read model, a day decided or executed shows its EFFECTIVE session
  // (a REPLACE as its replacement, a REST as rest), and the counters follow weekCounts' rule.
  if (effective) {
    const days = dates.map((date) => {
      const day = effective.find((d) => d.date === date);
      const row = planned.find((candidate) => candidate.planned_date === date);
      const race = races.find((event) => event.startDate <= date && date <= event.endDate);
      const fromPlanOnly = !day || day.source === "planned" || day.source === "none";
      const kind = fromPlanOnly ? row?.intervention?.kind : day.session?.kind;
      const hasSession = fromPlanOnly ? row !== undefined : day.session !== null;
      return {
        date,
        isToday: date === today,
        isPast: date < today,
        planned: hasSession ? (kind ? (SHORT_KIND_LABELS[kind] ?? "Séance") : "Séance") : null,
        plannedLabel: hasSession ? (kind ? (TRAINING_KIND_LABELS[kind] ?? "Séance prévue") : "Séance prévue") : null,
        plannedDurationMin: (fromPlanOnly ? row?.intervention?.duration_min : day.session?.duration_min) ?? null,
        performed: day?.status === "completed",
        adapted: day?.adaptation !== null && day?.adaptation !== undefined,
        race: race ? race.eventName : null,
      };
    });
    // « prévues »: the effective session is a training session (decided / executed days), else the plan row is one.
    const isTraining = (date: string): boolean => {
      const day = effective.find((d) => d.date === date);
      if (day && day.source !== "planned" && day.source !== "none") return isTrainingDay(day);
      const row = planned.find((candidate) => candidate.planned_date === date);
      return row !== undefined && isTrainingSession(row);
    };
    return { days, plannedCount: dates.filter(isTraining).length, performedCount: days.filter((d) => d.performed).length };
  }
  const days = dates.map((date) => {
    const row = planned.find((candidate) => candidate.planned_date === date);
    // UX-11R.9 — the shared "day done" rule (legacy non-skipped first, else a completed guided session).
    const performed = isDayDone(date, completed, guided);
    const race = races.find((event) => event.startDate <= date && date <= event.endDate);
    const kind = row?.intervention?.kind;
    return {
      date,
      isToday: date === today,
      isPast: date < today,
      planned: row ? (kind ? (SHORT_KIND_LABELS[kind] ?? "Séance") : "Séance") : null,
      plannedLabel: row ? (kind ? (TRAINING_KIND_LABELS[kind] ?? "Séance prévue") : "Séance prévue") : null,
      plannedDurationMin: row?.intervention?.duration_min ?? null,
      performed,
      adapted: false,
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

/**
 * UX-05 — "N check-ins cette semaine": the number of distinct days, Monday
 * through today, with a saved check-in. A plain count of existing rows — no
 * streak, no score. `checkedInToday` covers a check-in saved after the
 * page loaded its week.
 */
export function weekCheckinCount(checkinDates: string[], today: string, checkedInToday: boolean): number {
  const dates = weekDates(today).filter((date) => date <= today);
  const days = new Set(checkinDates.filter((date) => dates.includes(date)));
  if (checkedInToday) days.add(today);
  return days.size;
}
