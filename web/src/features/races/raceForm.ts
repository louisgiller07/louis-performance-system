// A09 — pure rules of the race form (no I/O). Dates are "YYYY-MM-DD" and
// compare as plain strings, like everywhere else in the app.
import { addDays } from "../../lib/date";
import { RACE_FORMAT_DAYS, RACES, type RacePriority } from "./racePresentation";

export interface RaceDraft {
  eventName: string;
  startDate: string;
  endDate: string;
  priority: RacePriority;
  /** null only for an existing race stored without a format (kept as is, never guessed). */
  raceFormat: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The end date a format imposes (2 / 3 days), else the current one, never before the start. */
export function endDateFor(raceFormat: string | null, startDate: string, currentEnd: string): string {
  const days = raceFormat === null ? undefined : RACE_FORMAT_DAYS[raceFormat];
  if (!ISO_DATE.test(startDate)) return currentEnd;
  if (days !== undefined) return addDays(startDate, days - 1);
  return currentEnd && currentEnd >= startDate ? currentEnd : startDate;
}

/** The first problem of a draft, or null. `today` is the effective today (simulation clock included). */
export function validateRaceDraft(draft: RaceDraft, today: string): string | null {
  if (draft.eventName.trim().length === 0) return RACES.errors.name;
  if (!ISO_DATE.test(draft.startDate) || !ISO_DATE.test(draft.endDate)) return RACES.errors.dates;
  if (draft.endDate < draft.startDate) return RACES.errors.order;
  if (draft.endDate < today) return RACES.errors.past;
  const days = draft.raceFormat === null ? undefined : RACE_FORMAT_DAYS[draft.raceFormat];
  if (days !== undefined && draft.endDate !== addDays(draft.startDate, days - 1)) return RACES.errors.duration(days);
  return null;
}
