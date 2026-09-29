import { formatConfidence } from "./dailyPlanLabels";
import type { DailyPlan } from "./dailyPlanTypes";

// V0.3 UX PREMIUM REDESIGN — "État de préparation" (was "Readiness") as a pilot status readout, not a
// dashboard. Same three signals as before (confidence, health signal,
// monitoring), relabeled/reworded, still ALL sourced from fields already
// on DailyPlan — no new score, no new engine field. CONFIANCE renders the
// dailyPlan.confidence through CONFIDENCE_LABELS (REV-015.1: never the raw
// "LOW"/"MEDIUM"/"HIGH" enum). ÉTAT DU CORPS is a plain-language read of the same
// server-derived hasHealthSignal boolean DailyPlanView already receives
// (never a frontend-deduced A1-A5 rule). ATTENTION shows the first real
// monitoring.observe entry verbatim when present — never a count, never
// invented text.
export function ReadinessCard({ dailyPlan, hasHealthSignal }: { dailyPlan: DailyPlan; hasHealthSignal: boolean }) {
  const attention = dailyPlan.monitoring.observe[0];
  // REV-015.1 — French label only; the raw LOW/MEDIUM/HIGH enum is never rendered.
  const confidenceLabel = formatConfidence(dailyPlan.confidence);

  return (
    <div className="rounded-lg border border-white/5 bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">État de préparation</h3>
      <div className="mt-3 flex flex-col gap-3">
        {confidenceLabel && (
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted">Confiance</p>
            <p className="text-sm font-semibold uppercase text-ink">{confidenceLabel}</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted">État du corps</p>
          <p className={`text-sm font-semibold uppercase ${hasHealthSignal ? "text-red-400" : "text-gold"}`}>
            {hasHealthSignal ? "Signal actif" : "Prêt"}
          </p>
        </div>
        {attention && (
          <div className="border-t border-white/5 pt-3">
            <p className="text-xs uppercase tracking-wide text-muted">Attention</p>
            <p className="mt-1 text-sm text-ink/90">{attention}</p>
          </div>
        )}
      </div>
    </div>
  );
}
