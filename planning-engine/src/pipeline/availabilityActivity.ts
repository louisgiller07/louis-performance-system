/**
 * BUG-V2-1 — physical vs riding availability, per date. Pure, shared by the
 * WeekSegmenter (where a session may be placed) and the V2 builders (which
 * endurance activities a placed session may offer).
 *
 * A window serves "physical", "riding", or both when it has no `activity`
 * (every window declared before BUG-V2-1): a legacy snapshot therefore
 * yields exactly its previous dates and capacities.
 *
 * Per date:
 * - locked date: nothing;
 * - an exception for the date wins outright: `available: false` revokes
 *   everything; `available: true` grants both activities (an exception
 *   carries no activity and no hours), with the capacity of that day's
 *   compatible windows when it has some, else unknown (`null`);
 * - otherwise an activity is available iff the date's day of week has at
 *   least one compatible window; its capacity is the LONGEST single
 *   compatible window (two short windows are never added up).
 */
import type { PlanInputAvailability, PlanInputAvailabilityActivity, PlanInputAvailabilityWindow, PlanInputLockedDate } from "../types/planInputSnapshot.js";

export type AvailabilityActivity = PlanInputAvailabilityActivity;
export const AVAILABILITY_ACTIVITIES: readonly AvailabilityActivity[] = ["physical", "riding"];

/** Capacity of one activity on one date: `undefined` = not available, `null` = available with no known time limit, else minutes. */
export type ActivityCapacity = number | null | undefined;

export interface DateAvailability {
  date: string;
  physical: ActivityCapacity;
  riding: ActivityCapacity;
}

/** A window time that is not "HH:mm" / "HH:mm:ss", or a window that does not end after it starts — never guessed around. */
export class InvalidAvailabilityWindowError extends Error {
  constructor(public readonly window: PlanInputAvailabilityWindow) {
    super(`Invalid availability window on dayOfWeek ${window.dayOfWeek}: "${window.startTime}"-"${window.endTime}"`);
    this.name = "InvalidAvailabilityWindowError";
  }
}

// "HH:mm" (snapshot contract) or "HH:mm:ss" (what Postgres `time` returns
// through PostgREST, passed through unchanged by buildPlanInputSnapshot).
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseTimeSeconds(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (match === null) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
  if (hours > 24 || minutes > 59 || seconds > 59 || (hours === 24 && (minutes > 0 || seconds > 0))) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Whole minutes between a window's start and end ("18:00"-"19:00" -> 60). Throws InvalidAvailabilityWindowError for a malformed or non-positive window (the DB itself enforces end_time > start_time). */
export function windowCapacityMinutes(window: PlanInputAvailabilityWindow): number {
  const start = parseTimeSeconds(window.startTime);
  const end = parseTimeSeconds(window.endTime);
  if (start === null || end === null || end <= start) {
    throw new InvalidAvailabilityWindowError(window);
  }
  return Math.floor((end - start) / 60);
}

/** A window without `activity` (legacy) serves both. */
export function windowServes(window: PlanInputAvailabilityWindow, activity: AvailabilityActivity): boolean {
  return window.activity === undefined || window.activity === activity;
}

/** Manual UTC parsing, never `new Date(isoString)` — same discipline as runDailyFor.ts's own addDays, for the same local-timezone-ambiguity reason. */
export function dayOfWeekFor(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, day as number)).getUTCDay();
}

/** Longest compatible window per day of week, for one activity (validates every window it reads). */
function longestByDayOfWeek(availability: PlanInputAvailability, activity: AvailabilityActivity): Map<number, number> {
  const longest = new Map<number, number>();
  for (const window of availability.windows) {
    const capacity = windowCapacityMinutes(window);
    if (!windowServes(window, activity)) continue;
    longest.set(window.dayOfWeek, Math.max(capacity, longest.get(window.dayOfWeek) ?? 0));
  }
  return longest;
}

/** Availability of every given date, per activity. */
export function availabilityByDate(
  dates: readonly string[],
  availability: PlanInputAvailability,
  lockedDates: readonly PlanInputLockedDate[] = []
): DateAvailability[] {
  const locked = new Set(lockedDates.map((l) => l.date));
  const exceptionByDate = new Map(availability.exceptions.map((e) => [e.date, e.available]));
  const longest = {
    physical: longestByDayOfWeek(availability, "physical"),
    riding: longestByDayOfWeek(availability, "riding"),
  };
  return dates.map((date) => {
    if (locked.has(date)) return { date, physical: undefined, riding: undefined };
    const exception = exceptionByDate.get(date);
    if (exception === false) return { date, physical: undefined, riding: undefined };
    const dow = dayOfWeekFor(date);
    const capacity = (activity: AvailabilityActivity): ActivityCapacity => {
      const minutes = longest[activity].get(dow);
      if (minutes !== undefined) return minutes;
      return exception === true ? null : undefined;
    };
    return { date, physical: capacity("physical"), riding: capacity("riding") };
  });
}

/** Whether `activity` is available on `date` (locked dates excluded). */
export function isActivityAvailableOn(
  date: string,
  activity: AvailabilityActivity,
  availability: PlanInputAvailability,
  lockedDates: readonly PlanInputLockedDate[] = []
): boolean {
  return availabilityByDate([date], availability, lockedDates)[0]![activity] !== undefined;
}
