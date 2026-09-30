import { athleteSafeMonitoring } from "./safetyPresentation";
import type { DailyPlan } from "./dailyPlanTypes";

// V0.3 UX PREMIUM REDESIGN — "État de préparation" (was "Readiness") as a pilot status readout, not a
// dashboard. Same three signals as before (confidence, health signal,
// monitoring), relabeled/reworded, still ALL sourced from fields already
// on DailyPlan — no new score, no new engine field. CONFIANCE renders the
// dailyPlan.confidence through CONFIDENCE_LABELS (REV-015.1: never the raw
// "LOW"/"MEDIUM"/"HIGH" enum). ÉTAT DU CORPS is a plain-language read of the same
// server-derived hasHealthSignal boolean DailyPlanView already receives
// (never a frontend-deduced A1-A5 rule). ATTENTION shows the first real
// monitoring.observe entry when present — never a count, never invented
// text — through the same athleteSafeMonitoring as DailyPlanView's "À
// surveiller" (REV-014b: PAIN_NON_SAFETY embeds the raw pain_location_code,
// e.g. "(knee_R, intensité 4/10)", which must render as its French label).
// UX-10A — the engine's confidence level is never shown to the rider.
export function ReadinessCard({ dailyPlan, hasHealthSignal }: { dailyPlan: DailyPlan; hasHealthSignal: boolean }) {
  const attention = athleteSafeMonitoring(dailyPlan)[0];

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">État de préparation</h3>
      <div className="mt-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">État du corps</p>
          <p className={`mt-1 font-display text-2xl font-extrabold uppercase leading-none ${hasHealthSignal ? "text-red-400" : "text-gold"}`}>
            {hasHealthSignal ? "Signal actif" : "Prêt"}
          </p>
        </div>
      </div>
      {attention && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Attention</p>
          <p className="mt-1 text-sm text-ink/90">{attention}</p>
        </div>
      )}
    </div>
  );
}
