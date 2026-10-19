// A09 — pure rules of the race form (no I/O). Dates are "YYYY-MM-DD" and
// compare as plain strings, like everywhere else in the app.
import { addDays } from "../../lib/date";
import { RACE_FORMAT_DAYS, RACES, type RacePriority } from "./racePresentation";
import { seriesOption } from "./raceProtocol";

export interface RaceDraft {
  eventName: string;
  startDate: string;
  endDate: string;
  priority: RacePriority;
  /** null only for an existing race stored without a format (kept as is, never guessed). */
  raceFormat: string | null;
  /**
   * SPORT-RACE-01P.3 — the competition: a code of RACE_SERIES (the format follows from it), or an existing race's
   * stored value kept as is (null or a free text written before this contract).
   */
  series: string | null;
}

/** The pair an existing race was stored with, kept as is when the rider does not choose a competition. */
export interface StoredRaceKind {
  raceFormat: string | null;
  series: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The end date a format imposes (2 / 3 days), else the current one, never before the start. */
export function endDateFor(raceFormat: string | null, startDate: string, currentEnd: string): string {
  const days = raceFormat === null ? undefined : RACE_FORMAT_DAYS[raceFormat];
  if (!ISO_DATE.test(startDate)) return currentEnd;
  if (days !== undefined) return addDays(startDate, days - 1);
  return currentEnd && currentEnd >= startDate ? currentEnd : startDate;
}

/**
 * The first problem of a draft, or null. `today` is the effective today (simulation clock included). A new race must
 * name its competition; an existing one may keep the competition / format it was stored with (`stored`), never
 * silently converted.
 */
export function validateRaceDraft(draft: RaceDraft, today: string, stored?: StoredRaceKind): string | null {
  if (draft.eventName.trim().length === 0) return RACES.errors.name;
  const keepsStored = stored !== undefined && draft.series === stored.series && draft.raceFormat === stored.raceFormat;
  const option = seriesOption(draft.series);
  if (!keepsStored && (option === undefined || option.raceFormat !== draft.raceFormat)) return RACES.errors.competition;
  if (!ISO_DATE.test(draft.startDate) || !ISO_DATE.test(draft.endDate)) return RACES.errors.dates;
  if (draft.endDate < draft.startDate) return RACES.errors.order;
  if (draft.endDate < today) return RACES.errors.past;
  const days = draft.raceFormat === null ? undefined : RACE_FORMAT_DAYS[draft.raceFormat];
  if (days !== undefined && draft.endDate !== addDays(draft.startDate, days - 1)) return RACES.errors.duration(days);
  return null;
}
