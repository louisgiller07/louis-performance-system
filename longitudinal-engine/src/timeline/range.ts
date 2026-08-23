/**
 * Range validation + calendar-safe, timezone-independent date
 * materialization. The `DateRange` TypeScript interface (types/adapter.ts)
 * does not itself guarantee its strings are well-formed or in order — this
 * module is the one place that boundary is actually enforced, at
 * buildTimeline's entrypoint.
 *
 * All arithmetic below is anchored to UTC millisecond timestamps via
 * `Date.UTC`/`getUTC*` exclusively — never a local-timezone `Date`
 * constructor or `get*` accessor — so results are identical regardless of
 * the host machine's timezone, and month/year boundaries and leap days
 * fall out of plain millisecond addition without special-casing.
 */
import type { DateRange } from "../types/adapter.js";

export class InvalidDateRangeError extends Error {
  constructor(reason: string) {
    super(`Invalid DateRange: ${reason}`);
    this.name = "InvalidDateRangeError";
  }
}

const CANONICAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Exported for reuse by calculators/horizonDates.ts (M5_004) — same UTC-safe arithmetic, never reimplemented. Not re-exported through index.ts; a same-package internal import only. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parses a canonical "YYYY-MM-DD" string to a UTC-midnight timestamp, rejecting both malformed strings and impossible calendar dates (e.g. 2026-02-30) via an exact round-trip check.
 * Exported for reuse by calculators/horizonDates.ts (M5_004) — same reasoning as MS_PER_DAY above. Throws {@link InvalidDateRangeError}; callers outside this module that need a different error identity (e.g. InvalidObservedThroughDateError) catch and rewrap.
 */
export function parseCanonicalDateUtc(value: string, label: string): number {
  const match = CANONICAL_DATE.exec(value);
  if (!match) {
    throw new InvalidDateRangeError(`${label} "${value}" is not in canonical YYYY-MM-DD format`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utcMs);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new InvalidDateRangeError(`${label} "${value}" is not a real calendar date`);
  }
  return utcMs;
}

/** Exported for reuse by calculators/horizonDates.ts (M5_004) — see MS_PER_DAY doc above. */
export function formatUtcMs(ms: number): string {
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Validates `range` and returns every calendar date in
 * `[range.fromDate, range.toDate]`, inclusive, ascending. `fromDate ===
 * toDate` (a single-day range) is valid. Throws {@link InvalidDateRangeError}
 * for malformed dates, impossible calendar dates, or `fromDate > toDate`.
 */
export function materializeDateRange(range: DateRange): readonly string[] {
  const fromMs = parseCanonicalDateUtc(range.fromDate, "fromDate");
  const toMs = parseCanonicalDateUtc(range.toDate, "toDate");
  if (fromMs > toMs) {
    throw new InvalidDateRangeError(`fromDate "${range.fromDate}" is after toDate "${range.toDate}"`);
  }

  const dates: string[] = [];
  for (let ms = fromMs; ms <= toMs; ms += MS_PER_DAY) {
    dates.push(formatUtcMs(ms));
  }
  return dates;
}
