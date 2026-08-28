/**
 * V0.3_001A — the ONE server-authoritative source of "today" for
 * longitudinal orchestration (outcome maturity, the source-query upper
 * bound, and the derived timeline's upper bound). Pure: no I/O, no
 * network, no dependency on the caller's own runtime timezone.
 *
 * Deliberately NOT `web/src/lib/date.ts`'s `todayLocal()` — that function
 * resolves the CALLER's own runtime timezone (correct for a browser, where
 * the caller IS the athlete's device; wrong for a Deno server, which would
 * resolve to the server's own OS timezone, not `Europe/Zurich`). This
 * module fixes the timezone explicitly instead, since no per-athlete
 * timezone field exists in the schema yet (V1 limitation — see
 * docs/06_ARCHITECTURE.md §V0.3_001).
 *
 * This value is NEVER accepted from a request — see
 * docs/11_DECISION_LOG.md (V0.3_001 architecture lock): unlike `daily-run`'s
 * `date` body param (whose worst case is a wrong-day, always-recomputable
 * `DailyPlan`), `decision_outcomes` rows are NOT supersede-on-change —
 * a client-forged future date here would permanently and prematurely
 * mature an outcome from incomplete data. Computed fresh, server-side,
 * every call.
 */

/** V1 fixed product timezone — see docs/06_ARCHITECTURE.md §V0.3_001 for the documented limitation (no per-athlete timezone field exists yet). */
export const LONGITUDINAL_PROCESSING_TIMEZONE = "Europe/Zurich";

/**
 * Returns the current calendar date (`YYYY-MM-DD`) in
 * `LONGITUDINAL_PROCESSING_TIMEZONE`, DST-safe via `Intl.DateTimeFormat`'s
 * own IANA timezone handling — the same underlying technique already
 * proven by `web/src/lib/date.ts`'s `todayLocal()`, just evaluated against
 * a fixed zone instead of the caller's own. `now` is injectable for
 * deterministic tests; the runtime default is `new Date()` (the server's
 * own clock at call time).
 */
export function currentLongitudinalProcessingDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONGITUDINAL_PROCESSING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("currentLongitudinalProcessingDate: failed to compute the current Europe/Zurich calendar date.");
  }

  return `${year}-${month}-${day}`;
}
