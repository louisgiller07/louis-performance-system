import { bodyStatusOf, healthSignalReasonOf } from "./bodyStatus";
import { DailyPlanView } from "./DailyPlanView";
import { ReadinessCard } from "./ReadinessCard";
import { MissionHero } from "./MissionHero";
import { CoachStateCard } from "./CoachStateCard";
import { noCompatibleSessionOf } from "./noCompatibleSession";
import { withoutPlannedSessionOf } from "./withoutPlannedSession";
import type { CheckinRow } from "../checkin/checkinTypes";
import type { DailyRunResponse } from "./dailyPlanTypes";
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";

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
  /** CONSISTENCY-01 — the day's planned session is the rider's own modification (planned_sessions.source = 'manual'). */
  sessionModifiedByAthlete?: boolean;
}

export function DailyPlanResult({
  result,
  today,
  finalPrescriptionV2,
}: {
  result: DailyRunResponse;
  today?: TodayPresentation;
  /** UX-11A.5c.4 — V2 daily decisions only (computed by DailyPlanPanel from the live response or the database). */
  finalPrescriptionV2?: FinalPrescriptionV2State;
}) {
  const { dailyPlan, healthFlagId, warnings, decisionId, executablePrescription, executablePrescriptionStatus } = result;

  // Explicit server signal only — never a frontend-deduced safety rule: P0-SAFE reads the persisted
  // decision (a signal created, a Safety-layer rule, a declared pain) through bodyStatus.ts.
  const bodyStatus = bodyStatusOf(dailyPlan, healthFlagId);
  const hasHealthSignal = bodyStatus === "signal";

  return (
    <DailyPlanView
      dailyPlan={dailyPlan}
      warnings={warnings}
      hasHealthSignal={hasHealthSignal}
      healthSignalReason={healthSignalReasonOf(dailyPlan)}
      technicalMetadata={{ decisionId, raw: result }}
      readinessSlot={
        today ? (
          // UX-04 — Today's coach reading: retained signals + the athlete's declared state.
          <CoachStateCard dailyPlan={dailyPlan} hasHealthSignal={hasHealthSignal} bodyStatus={bodyStatus} checkin={today.checkin} revealed={today.revealed} />
        ) : (
          <ReadinessCard dailyPlan={dailyPlan} hasHealthSignal={hasHealthSignal} bodyStatus={bodyStatus} />
        )
      }
      missionSlot={
        <MissionHero
          dailyPlan={dailyPlan}
          sessionModifiedByAthlete={today?.sessionModifiedByAthlete ?? false}
          noCompatibleSession={today ? noCompatibleSessionOf(finalPrescriptionV2, today.checkin?.available_minutes_today) : null}
          withoutPlannedSession={withoutPlannedSessionOf(finalPrescriptionV2, dailyPlan.final_session)}
        />
      }
      heroInMission
      detailsTarget={today ? (today.detailsTarget ?? null) : undefined}
      executablePrescription={executablePrescription}
      executablePrescriptionStatus={executablePrescriptionStatus}
      finalPrescriptionV2={finalPrescriptionV2}
    />
  );
}
