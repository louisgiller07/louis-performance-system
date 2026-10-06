/**
 * BUG-V2-3 — the product calendar: what "today" is on the server, and when a
 * newly generated plan starts.
 *
 * "Today" is the calendar date in the product timezone, never the UTC date
 * (`new Date().toISOString().slice(0, 10)` is the previous day in
 * Europe/Zurich between 00:00 and 01:00/02:00 local). No per-athlete
 * timezone exists in the schema: the V1 fixed product timezone is the one
 * already used by the longitudinal engine (`LONGITUDINAL_PROCESSING_TIMEZONE`,
 * docs/06_ARCHITECTURE.md §V0.3_001), and the web's own `todayLocal()` gives
 * the same date for a rider in Switzerland.
 *
 * Plan start: a new plan starts the day AFTER its generation date, whatever
 * the hour. The planner knows how long each availability window is, never
 * its real clock time (BUG-V2-1), and nothing tells it whether the rider
 * already trained today: it has no explicit reason to put a session on the
 * generation day, so it never does. Same rule in the morning and at 22:00.
 */

export const PRODUCT_TIMEZONE = "Europe/Zurich";

/** Days between the generation date and the first day of a new plan. */
export const PLAN_START_OFFSET_DAYS = 1;

/** Current calendar date (`YYYY-MM-DD`) in the product timezone, DST-safe. `now` is injectable for tests. */
export function productToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PRODUCT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) throw new Error(`productToday: failed to compute the current ${PRODUCT_TIMEZONE} calendar date.`);
  return `${year}-${month}-${day}`;
}

/** Calendar-day arithmetic on an ISO date (UTC components, no DST effect on a bare date). */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + days)).toISOString().slice(0, 10);
}

/** First day of a plan generated on `generationDate` (the product's today). */
export function planStartDateFor(generationDate: string): string {
  return addCalendarDays(generationDate, PLAN_START_OFFSET_DAYS);
}
