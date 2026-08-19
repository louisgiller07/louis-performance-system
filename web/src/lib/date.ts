// Local calendar date for the current user — never the server's/UTC date.
// `new Date().toISOString().slice(0, 10)` is deliberately never used here:
// it returns the UTC date, which is wrong for any user not in a UTC-like
// offset (e.g. `2026-08-18T22:30Z` is already `2026-08-19` in
// Europe/Zurich). `timeZone` exists only to make tests deterministic —
// runtime callers omit it and get the browser/device's own timezone.
export function todayLocal(timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("todayLocal: failed to compute a local date.");
  }

  return `${year}-${month}-${day}`;
}

const CALENDAR_DATE_FORMAT = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" });

/**
 * Friendly display of a stored SQL `date` value (e.g. decisions.decision_date,
 * "YYYY-MM-DD"). Parses the Y/M/D components and builds a local Date from
 * them — never `new Date(dateString)`, which parses a bare date as UTC
 * midnight and can render the wrong day near a timezone boundary.
 */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return CALENDAR_DATE_FORMAT.format(new Date(year, month - 1, day));
}

const LOCAL_TIME_FORMAT = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });

/**
 * Friendly local time for a `timestamptz` column (e.g. decisions.created_at).
 * Unlike a bare SQL date, an ISO timestamp carries real offset information,
 * so `new Date(isoTimestamp)` is safe here — it's then formatted in the
 * browser's own timezone (no hardcoded zone).
 */
export function formatLocalTime(isoTimestamp: string): string {
  return LOCAL_TIME_FORMAT.format(new Date(isoTimestamp));
}
