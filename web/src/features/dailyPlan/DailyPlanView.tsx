import { PlanSection } from "../../components/PlanSection";
import { DecisionHero } from "./DecisionHero";
import { formatIntervention, isSameIntervention } from "./dailyPlanLabels";
import type { DailyPlan } from "./dailyPlanTypes";

export interface DailyPlanViewProps {
  dailyPlan: DailyPlan;
  /** Optional — a live daily-run response has warnings, a stored historical decision does not. */
  warnings?: string[];
  /**
   * Whether to show the health banner. Computed by the caller from data it
   * actually has (e.g. a live response's healthFlagId, or a stored
   * decision's own persisted health_flag_to_create) — never re-derived
   * here from dailyPlan fields like triggered_rules or decision=REST. No
   * A1-A5 rule lives in this component.
   */
  hasHealthSignal: boolean;
  healthSignalReason?: string;
  /** Dev-only debug panel content — omitted entirely if not provided. */
  technicalMetadata?: { decisionId?: string; raw: unknown };
}

// Rendering-only: production display of a real, already-computed
// DailyPlan (live from daily-run, or read back from decisions.daily_plan
// for /history). Every value shown comes from the data passed in — this
// file only decides layout and French labels (dailyPlanLabels.ts) — it
// never classifies, diagnoses, or invents a coaching/safety recommendation.
export function DailyPlanView({ dailyPlan, warnings = [], hasHealthSignal, healthSignalReason, technicalMetadata }: DailyPlanViewProps) {
  // Only worth comparing when there was an actual prior planned session —
  // planned_session_before === null (e.g. a fresh RACE_ACTIVITY day, no
  // prior training block session) must never render as "Prévu: —", which
  // reads as a discrepancy even for a plain KEEP.
  const sessionChanged =
    dailyPlan.planned_session_before !== null && !isSameIntervention(dailyPlan.planned_session_before, dailyPlan.final_session);

  return (
    <div className="flex flex-col gap-3">
      <DecisionHero dailyPlan={dailyPlan} />

      {hasHealthSignal && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-700">Attention santé</p>
          <p className="mt-0.5 text-xs text-red-600">{healthSignalReason ?? "Le coach a généré un signal de santé pour cette décision."}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <PlanSection title="Avertissements">
          <ul className="list-disc pl-4 text-amber-700">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {sessionChanged && (
        <PlanSection title="Séance">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-400">Prévu</p>
              <p className="font-medium text-gray-900">
                {dailyPlan.planned_session_before ? formatIntervention(dailyPlan.planned_session_before) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Aujourd'hui</p>
              <p className="font-medium text-gray-900">{formatIntervention(dailyPlan.final_session)}</p>
            </div>
          </div>
        </PlanSection>
      )}

      {dailyPlan.training.active && (
        <PlanSection title="Entraînement">
          {dailyPlan.training.session_type && <p className="font-medium text-gray-900">{formatIntervention(dailyPlan.training.session_type)}</p>}
          {dailyPlan.training.objective && <p className="text-gray-600">{dailyPlan.training.objective}</p>}
        </PlanSection>
      )}

      {dailyPlan.dh_or_technical.active && (
        <PlanSection title="Technique">
          {dailyPlan.dh_or_technical.focus && <p className="font-medium text-gray-900">{dailyPlan.dh_or_technical.focus}</p>}
          {dailyPlan.dh_or_technical.spot_hint && <p className="text-gray-600">{dailyPlan.dh_or_technical.spot_hint}</p>}
        </PlanSection>
      )}

      {dailyPlan.mental.active && (
        <PlanSection title="Mental">
          {dailyPlan.mental.focus && <p className="font-medium text-gray-900">{dailyPlan.mental.focus}</p>}
          {dailyPlan.mental.action_hint && <p className="text-gray-600">{dailyPlan.mental.action_hint}</p>}
        </PlanSection>
      )}

      {dailyPlan.recovery.active && dailyPlan.recovery.actions.length > 0 && (
        <PlanSection title="Récupération">
          <ul className="list-disc pl-4">
            {dailyPlan.recovery.actions.map((action, index) => (
              <li key={index}>{action}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {dailyPlan.sleep.active && (
        <PlanSection title="Sommeil">
          {dailyPlan.sleep.target_hours !== undefined && (
            <p className="font-medium text-gray-900">Objectif : {dailyPlan.sleep.target_hours} h</p>
          )}
          {dailyPlan.sleep.bedtime_hint && <p className="text-gray-600">{dailyPlan.sleep.bedtime_hint}</p>}
          {dailyPlan.sleep.notes && <p className="text-gray-600">{dailyPlan.sleep.notes}</p>}
        </PlanSection>
      )}

      {dailyPlan.nutrition.active && (
        <PlanSection title="Nutrition">
          {dailyPlan.nutrition.focus && <p className="font-medium text-gray-900">{dailyPlan.nutrition.focus}</p>}
          {dailyPlan.nutrition.hydration_target_l !== undefined && <p>Hydratation : {dailyPlan.nutrition.hydration_target_l} L</p>}
          {dailyPlan.nutrition.notes && <p className="text-gray-600">{dailyPlan.nutrition.notes}</p>}
        </PlanSection>
      )}

      {dailyPlan.protection.do_not_do.length > 0 && (
        <PlanSection title="À éviter">
          <ul className="list-disc pl-4 text-red-700">
            {dailyPlan.protection.do_not_do.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {dailyPlan.monitoring.observe.length > 0 && (
        <PlanSection title="À surveiller">
          <ul className="list-disc pl-4">
            {dailyPlan.monitoring.observe.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {dailyPlan.overrode_race_protocol && (
        <PlanSection title="Protocole de course">
          <p className="text-gray-900">Le protocole standard a été modifié pour aujourd'hui.</p>
          {dailyPlan.override_reason && <p className="text-gray-600">{dailyPlan.override_reason}</p>}
        </PlanSection>
      )}

      {dailyPlan.triggered_rules.length > 0 && (
        <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-900">Pourquoi cette décision ?</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {dailyPlan.triggered_rules.map((rule, index) => (
              <li key={index} className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                <p>{rule.detail}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {rule.layer} · {rule.rule_id}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {import.meta.env.DEV && technicalMetadata && (
        <details className="text-xs text-gray-400">
          <summary>Détails techniques</summary>
          {technicalMetadata.decisionId && <p className="mt-1">decisionId : {technicalMetadata.decisionId}</p>}
          <p className={technicalMetadata.decisionId ? "" : "mt-1"}>engine_version : {dailyPlan.engine_version}</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(technicalMetadata.raw, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
