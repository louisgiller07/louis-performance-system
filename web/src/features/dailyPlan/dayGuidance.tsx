// SPORT-SAFE-01R (HPM 2026-10-18, A1) — M1's own guidance for the day, carried where the rider trains: the
// protection (`protection.do_not_do`) and monitoring (`monitoring.observe`) the engine decided and persisted on the
// decision, sanitized exactly as on Today (athleteSafeProtection / athleteSafeMonitoring). Never a text of the
// browser's own: both lists empty → nothing is shown. The decision row is append-only, so the guidance of a started
// session is the one of the decision it was started from (frozen, like its prescription).
import { PlanSection } from "../../components/PlanSection";
import type { DailyPlan } from "./dailyPlanTypes";
import { athleteSafeMonitoring, athleteSafeProtection, athleteSafeTrainingObjective } from "./safetyPresentation";

export interface DayGuidance {
  protection: string[];
  monitoring: string[];
}

export function dayGuidanceOf(dailyPlan: DailyPlan): DayGuidance | null {
  const protection = athleteSafeProtection(dailyPlan);
  const monitoring = athleteSafeMonitoring(dailyPlan);
  return protection.length === 0 && monitoring.length === 0 ? null : { protection, monitoring };
}

/** SPORT-SAFE-01R.3 — the engine's trace of an A04 refusal kept beside A10's active-recovery alternative. */
export const A04_MODIFY_NOT_SUPPORTED_RULE_ID = "A04_MODIFY_NOT_SUPPORTED";

/**
 * SPORT-SAFE-01R.3 — on the day A10 replaced a refused session by the active recovery, the engine's own sentence for it
 * (`training.objective`: the planned session is not offered, another session replaces it). Null on any other day.
 */
export function alternativeNoteOf(dailyPlan: DailyPlan): string | null {
  if (!dailyPlan.triggered_rules.some((rule) => rule.rule_id === A04_MODIFY_NOT_SUPPORTED_RULE_ID)) return null;
  return athleteSafeTrainingObjective(dailyPlan) ?? null;
}

/** The same two sections, titles and styles as Today's « À éviter » / « À surveiller ». */
export function DayGuidanceSections({ guidance }: { guidance: DayGuidance }) {
  return (
    <div className="flex flex-col gap-3" data-testid="day-guidance">
      {guidance.protection.length > 0 && (
        <PlanSection title="À éviter">
          <ul className="list-disc pl-4 text-red-400">
            {guidance.protection.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </PlanSection>
      )}
      {guidance.monitoring.length > 0 && (
        <PlanSection title="À surveiller">
          <ul className="list-disc pl-4">
            {guidance.monitoring.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </PlanSection>
      )}
    </div>
  );
}
