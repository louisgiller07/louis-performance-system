import { DailyPlanView } from "./DailyPlanView";
import type { DailyRunResponse } from "./dailyPlanTypes";

// M4_005 — live daily-run result. Computes the health-signal and debug
// metadata from a real DailyRunResponse, then delegates all rendering to
// DailyPlanView (shared with /history's HistoryDetail — M4_006).
export function DailyPlanResult({ result }: { result: DailyRunResponse }) {
  const { dailyPlan, healthFlagId, warnings, decisionId } = result;

  // Explicit server signal only — never a frontend-deduced safety rule
  // (no A1-A5 hardcoded here).
  const hasHealthSignal = healthFlagId !== null || dailyPlan.health_flag_to_create !== undefined;

  return (
    <DailyPlanView
      dailyPlan={dailyPlan}
      warnings={warnings}
      hasHealthSignal={hasHealthSignal}
      healthSignalReason={dailyPlan.health_flag_to_create?.reason}
      technicalMetadata={{ decisionId, raw: result }}
    />
  );
}
