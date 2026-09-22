/**
 * WeekSequenceBuilder (V0.4_106A) — pure function dividing an
 * already-existing TrainingPlanBlock's date range into consecutive 7-day
 * WeekSequenceEntry intervals, starting exactly at `block.startDate` (never
 * realigned to a calendar Monday — nothing guarantees a block starts on
 * one, and block creation is out of this module's scope).
 *
 * Never reads `races` — week boundaries are pure calendar arithmetic, never
 * adjusted to keep a race from spanning two weeks (that would be an
 * invented placement rule, not a technical necessity: TemplateSelector's
 * own per-week overlap check, V0.4_104, already handles a boundary-
 * spanning race correctly on each affected week independently).
 *
 * Never decides deload/recovery cadence — no evidence exists anywhere in
 * this codebase for when a week should become one (V0.4_106 audit finding),
 * so none is invented here.
 *
 * Never calls TemplateSelector or WeekSegmenter — produces only the
 * date-boundary input a future orchestrator will hand to them, one week at
 * a time.
 */
import type { TrainingPlanBlock } from "../types/planBlock.js";

export interface WeekSequenceEntry {
  weekNumber: number; // 1-based, sequential
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface WeekSequenceBuilderInput {
  block: TrainingPlanBlock;
}

export interface WeekSequenceBuilderResult {
  weeks: WeekSequenceEntry[];
}

export class InvalidBlockRangeError extends Error {
  constructor(
    public readonly startDate: string,
    public readonly endDate: string
  ) {
    super(`block.endDate (${endDate}) must not be before block.startDate (${startDate})`);
    this.name = "InvalidBlockRangeError";
  }
}

const WEEK_LENGTH_DAYS = 7;

/** Manual UTC parsing, never `new Date(isoString)` — same discipline as WeekSegmenter/runDailyFor's own addDays, for the same local-timezone-ambiguity reason. */
function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + days));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Divides `input.block`'s date range into consecutive 7-day weeks. The
 * final week is shorter than 7 days whenever the block's duration is not
 * an exact multiple of 7 — accepted as-is, never rounded up or truncated
 * away.
 */
export function buildWeekSequence(input: WeekSequenceBuilderInput): WeekSequenceBuilderResult {
  const { startDate, endDate } = input.block;
  if (endDate < startDate) {
    throw new InvalidBlockRangeError(startDate, endDate);
  }

  const weeks: WeekSequenceEntry[] = [];
  let weekNumber = 1;
  let cursor = startDate;

  while (cursor <= endDate) {
    const naiveWeekEnd = addDays(cursor, WEEK_LENGTH_DAYS - 1);
    const weekEnd = naiveWeekEnd > endDate ? endDate : naiveWeekEnd;
    weeks.push({ weekNumber, startDate: cursor, endDate: weekEnd });
    weekNumber++;
    cursor = addDays(weekEnd, 1);
  }

  return { weeks };
}
