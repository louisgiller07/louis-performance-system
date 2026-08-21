import type { HealthFlagSource } from "../types/sources.js";

/**
 * `flag.flagDate <= day AND (flag.resolvedAt == null OR day <= flag.resolvedAt)`.
 * Plain string comparison is calendar-safe here: both sides are always
 * canonical zero-padded "YYYY-MM-DD", whose lexicographic order equals
 * calendar order — no Date object or timezone handling needed.
 */
export function isFlagActiveOnDay(flag: HealthFlagSource, day: string): boolean {
  if (flag.flagDate > day) return false;
  if (flag.resolvedAt === null) return true;
  return day <= flag.resolvedAt;
}
