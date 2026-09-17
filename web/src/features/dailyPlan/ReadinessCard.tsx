import type { DailyPlan } from "./dailyPlanTypes";

// V0.3 UX PREMIUM REDESIGN — "Readiness" as a pilot status readout, not a
// dashboard. Same three signals as before (confidence, health signal,
// monitoring), relabeled/reworded, still ALL sourced from fields already
// on DailyPlan — no new score, no new engine field. CONFIDENCE renders the
// raw dailyPlan.confidence enum ("LOW"/"MEDIUM"/"HIGH" — already English,
// no label map needed). BODY STATUS is a plain-language read of the same
// server-derived hasHealthSignal boolean DailyPlanView already receives
// (never a frontend-deduced A1-A5 rule). ATTENTION shows the first real
// monitoring.observe entry verbatim when present — never a count, never
// invented text.
export function ReadinessCard({ dailyPlan, hasHealthSignal }: { dailyPlan: DailyPlan; hasHealthSignal: boolean }) {
  const attention = dailyPlan.monitoring.observe[0];

  return (
    <div className="rounded-lg border border-white/5 bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Readiness</h3>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted">Confidence</p>
          <p className="text-sm font-semibold uppercase text-ink">{dailyPlan.confidence}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted">Body status</p>
          <p className={`text-sm font-semibold uppercase ${hasHealthSignal ? "text-red-400" : "text-gold"}`}>
            {hasHealthSignal ? "Signal actif" : "Ready"}
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
