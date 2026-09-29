import { formatIntervention } from "../dailyPlan/dailyPlanLabels";
import { formatDuration } from "../dailyPlan/durationLabels";
import type { TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import type { Adaptation } from "./programPresentation";

// UX-06 — a day the Head Coach actually adapted (today or past only): what
// was planned, what was decided, and why — the why in the same rider wording
// as Today's "Pourquoi ?" (coachInsights.ts), never recomputed here.
function describe(intervention: TrainingIntervention): string {
  const base = formatIntervention(intervention);
  return intervention.duration_min !== undefined ? `${base} · ${formatDuration(intervention.duration_min)}` : base;
}

export function ProgramAdaptationCard({ adaptation, compact = false }: { adaptation: Adaptation; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-gold/40 bg-gold/5 ${compact ? "mt-2 p-3" : "mt-4 p-4"}`}>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-gold">Adaptée par NALYNT</p>
      <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 ${compact ? "mt-1.5 text-xs" : "mt-2 text-sm"}`}>
        <dt className="text-muted">Prévu</dt>
        <dd className="text-ink/70 line-through decoration-muted/70">{describe(adaptation.planned)}</dd>
        <dt className="text-muted">Adapté</dt>
        <dd className="text-ink">{describe(adaptation.adapted)}</dd>
      </dl>
      <p className={`border-t border-gold/20 text-ink/85 ${compact ? "mt-2 pt-2 text-xs" : "mt-3 pt-3 text-sm"}`}>
        <span className="text-gold">Pourquoi : </span>
        {adaptation.why}
      </p>
    </div>
  );
}
