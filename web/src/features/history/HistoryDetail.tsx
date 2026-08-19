import { DailyPlanView } from "../dailyPlan/DailyPlanView";
import { CONFIDENCE_LABELS, TRAINING_MODE_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { Confidence, TrainingMode } from "../dailyPlan/dailyPlanTypes";
import { summarizeDecision } from "./historySummary";
import type { DecisionHistoryRow } from "./historyTypes";

// A stored decision is never recomputed — this renders exactly what
// persist_daily_run wrote to decisions.daily_plan at the time, via the
// same DailyPlanView used for a live result (M4_005). No daily-run call,
// no warnings (never persisted per-row), no health signal beyond what the
// stored DailyPlan itself carries (health_flag_to_create) — there is no
// way to know from history alone whether a health_flags row was actually
// created, so that isn't claimed here.
//
// The caller (HistoryDetailPage) already shows decisionDate/createdAt in
// its own header — this component doesn't repeat them, except the one
// safely-available DB field a degraded/legacy row can still show.
export function HistoryDetail({ row }: { row: DecisionHistoryRow }) {
  const summary = summarizeDecision(row);

  if (!summary.valid) {
    // active_mode/confidence_level are real, DAL-written DB columns (M2)
    // sharing the engine's own vocabulary — unlike finalSessionDb they can
    // safely go through the same label maps as a valid daily_plan. Both
    // are null on any row predating M2, so each is only shown if present.
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-700">Cette ancienne décision ne peut pas être affichée complètement.</p>
        <dl className="mt-3 flex flex-col gap-1 text-xs text-gray-500">
          {row.activeModeDb && (
            <div>
              <dt className="inline font-medium">Mode : </dt>
              <dd className="inline">{TRAINING_MODE_LABELS[row.activeModeDb as TrainingMode] ?? row.activeModeDb}</dd>
            </div>
          )}
          {row.confidenceLevelDb && (
            <div>
              <dt className="inline font-medium">Confiance : </dt>
              <dd className="inline">{CONFIDENCE_LABELS[row.confidenceLevelDb as Confidence] ?? row.confidenceLevelDb}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">Séance enregistrée (ancien format) : </dt>
            <dd className="inline">{row.finalSessionDb}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <DailyPlanView
      dailyPlan={summary.dailyPlan}
      hasHealthSignal={summary.dailyPlan.health_flag_to_create !== undefined}
      healthSignalReason={summary.dailyPlan.health_flag_to_create?.reason}
      technicalMetadata={{ decisionId: row.id, raw: summary.dailyPlan }}
    />
  );
}
