// V0.3_006A1 — athlete-facing labels for HealthFlagType. Never render the
// raw enum slug (e.g. "concussion_suspect") or the DB status name
// ("active"/"monitoring") to the athlete — see docs/11_DECISION_LOG.md
// V0.3_006A. A value not in this map falls back to itself rather than
// throwing, matching dailyPlanLabels.ts's own convention.
import type { HealthFlagType } from "../dailyPlan/dailyPlanTypes";

export const HEALTH_FLAG_TYPE_LABELS: Record<HealthFlagType, string> = {
  concussion_suspect: "Suspicion de commotion",
  injury_suspect: "Suspicion de blessure",
  illness: "Maladie / fièvre",
  pain_persistent: "Douleur persistante",
};

const FLAG_DATE_FORMAT = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" });

/** "9 septembre" from a "YYYY-MM-DD" flag_date — parsed as a local calendar date, never via `new Date(string)` (UTC-midnight parsing can shift the displayed day near a timezone boundary). */
export function formatFlagDate(flagDate: string): string {
  const [year, month, day] = flagDate.split("-").map(Number);
  return FLAG_DATE_FORMAT.format(new Date(year, month - 1, day));
}
