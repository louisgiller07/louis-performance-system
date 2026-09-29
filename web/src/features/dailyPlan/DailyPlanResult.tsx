import { DailyPlanView } from "./DailyPlanView";
import { ReadinessCard } from "./ReadinessCard";
import { MissionHero } from "./MissionHero";
import type { DailyRunResponse } from "./dailyPlanTypes";

// UX-03 — Today's live result leads with the unified MissionHero (mission,
// planned → adapted, decision, confidence, reasoning); DailyPlanView then
// renders the rest without repeating those (heroInMission).
// M4_005 — live daily-run result. Computes the health-signal and debug
// metadata from a real DailyRunResponse, then delegates all rendering to
// DailyPlanView (shared with /history's HistoryDetail — M4_006).
export function DailyPlanResult({ result }: { result: DailyRunResponse }) {
  const { dailyPlan, healthFlagId, warnings, decisionId, executablePrescription } = result;

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
      readinessSlot={<ReadinessCard dailyPlan={dailyPlan} hasHealthSignal={hasHealthSignal} hideConfidence />}
      missionSlot={<MissionHero dailyPlan={dailyPlan} />}
      heroInMission
      executablePrescription={executablePrescription}
    />
  );
}
