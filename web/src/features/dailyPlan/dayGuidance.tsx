// SPORT-SAFE-01R (HPM 2026-10-18, A1) — M1's own guidance for the day, carried where the rider trains: the
// protection (`protection.do_not_do`) and monitoring (`monitoring.observe`) the engine decided and persisted on the
// decision, sanitized exactly as on Today (athleteSafeProtection / athleteSafeMonitoring). Never a text of the
// browser's own: both lists empty → nothing is shown. The decision row is append-only, so the guidance of a started
// session is the one of the decision it was started from (frozen, like its prescription).
import { PlanSection } from "../../components/PlanSection";
import type { DailyPlan } from "./dailyPlanTypes";
import { athleteSafeMonitoring, athleteSafeProtection } from "./safetyPresentation";

export interface DayGuidance {
  protection: string[];
  monitoring: string[];
}

export function dayGuidanceOf(dailyPlan: DailyPlan): DayGuidance | null {
  const protection = athleteSafeProtection(dailyPlan);
  const monitoring = athleteSafeMonitoring(dailyPlan);
  return protection.length === 0 && monitoring.length === 0 ? null : { protection, monitoring };
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
