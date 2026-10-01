import { DailyPlanView } from "./DailyPlanView";
import { ReadinessCard } from "./ReadinessCard";
import { MissionHero } from "./MissionHero";
import { CoachStateCard } from "./CoachStateCard";
import type { CheckinRow } from "../checkin/checkinTypes";
import type { DailyRunResponse } from "./dailyPlanTypes";

// UX-03 — Today's live result leads with the unified MissionHero (mission,
// planned → adapted, decision, confidence, reasoning); DailyPlanView then
// renders the rest without repeating those (heroInMission).
// M4_005 — live daily-run result. Computes the health-signal and debug
// metadata from a real DailyRunResponse, then delegates all rendering to
// DailyPlanView (shared with /history's HistoryDetail — M4_006).
export interface TodayPresentation {
  /** Today's check-in as saved (values shown in "Ton état du jour"); null when not available. */
  checkin: CheckinRow | null;
  /** True right after a fresh analysis (not on a restore): longer reveal of what the coach retained. */
  revealed: boolean;
  /** UX-05 — where "Voir les détails du plan" is rendered (bottom of Today); null until mounted. */
  detailsTarget?: HTMLElement | null;
}

export function DailyPlanResult({ result, today }: { result: DailyRunResponse; today?: TodayPresentation }) {
  const { dailyPlan, healthFlagId, warnings, decisionId, executablePrescription, executablePrescriptionStatus } = result;

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
      readinessSlot={
        today ? (
          // UX-04 — Today's coach reading: retained signals + the athlete's declared state.
          <CoachStateCard dailyPlan={dailyPlan} hasHealthSignal={hasHealthSignal} checkin={today.checkin} revealed={today.revealed} />
        ) : (
          <ReadinessCard dailyPlan={dailyPlan} hasHealthSignal={hasHealthSignal} />
        )
      }
      missionSlot={<MissionHero dailyPlan={dailyPlan} />}
      heroInMission
      detailsTarget={today ? (today.detailsTarget ?? null) : undefined}
      executablePrescription={executablePrescription}
      executablePrescriptionStatus={executablePrescriptionStatus}
    />
  );
}
