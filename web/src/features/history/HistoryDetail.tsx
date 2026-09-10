import { DailyPlanView } from "../dailyPlan/DailyPlanView";
import { CONFIDENCE_LABELS, TRAINING_MODE_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { Confidence, TrainingMode } from "../dailyPlan/dailyPlanTypes";
import { summarizeDecision } from "./historySummary";
import type { DecisionHistoryRow } from "./historyTypes";
import { NO_COMPLETED_SESSION_COPY, SAME_DAY_UNASSOCIATED_COPY, type PerformedMatch } from "./historyPerformedMatch";
import { HistoryPerformedSummary } from "./HistoryPerformedSummary";

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
//
// V0.3_007D — makes the PRESCRIT/RÉALISÉ separation explicit. `performedMatch`
// is the exact, already-computed classification (historyPerformedMatch.ts)
// of the one completed_sessions row, if any, tied to THIS decision by its
// own decision_id — never a same-day guess. Shown regardless of whether the
// prescription itself rendered fully or degraded (a legacy decision can
// still have a real linked completed session).
export function HistoryDetail({ row, performedMatch }: { row: DecisionHistoryRow; performedMatch: PerformedMatch }) {
  const summary = summarizeDecision(row);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Prescrit</h2>

      {!summary.valid ? (
        // active_mode/confidence_level are real, DAL-written DB columns (M2)
        // sharing the engine's own vocabulary — unlike finalSessionDb they can
        // safely go through the same label maps as a valid daily_plan. Both
        // are null on any row predating M2, so each is only shown if present.
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
      ) : (
        <DailyPlanView
          dailyPlan={summary.dailyPlan}
          hasHealthSignal={summary.dailyPlan.health_flag_to_create !== undefined}
          healthSignalReason={summary.dailyPlan.health_flag_to_create?.reason}
          technicalMetadata={{ decisionId: row.id, raw: summary.dailyPlan }}
        />
      )}

      <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Réalisé</h2>

      <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
        {performedMatch.kind === "linked" && <HistoryPerformedSummary session={performedMatch.session} />}
        {performedMatch.kind === "same_day_unassociated" && <p>{SAME_DAY_UNASSOCIATED_COPY}</p>}
        {performedMatch.kind === "none" && <p>{NO_COMPLETED_SESSION_COPY}</p>}
      </div>
    </div>
  );
}
