import { PlanSection } from "../../components/PlanSection";
import type { ExecutableIntensity, ExecutablePrescription, ExecutableRepScheme } from "./dailyPlanTypes";

const ROLE_LABELS: Record<string, string> = {
  warm_up: "Échauffement",
  work: "Travail",
  accessory: "Accessoire",
};

/**
 * Mechanical id -> label (lowercase, split "_", capitalize each word) — same
 * discipline as trainingPlanReview's own humanizeLabel, duplicated locally
 * rather than cross-imported (siblings across feature folders stay
 * decoupled, no shared build boundary — same precedent applied throughout
 * this codebase). No catalogue lookup exists on the web side; this is the
 * honest minimal fallback, never an invented translation.
 */
function humanizeId(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatRepScheme(repScheme: ExecutableRepScheme): string {
  switch (repScheme.type) {
    case "fixed":
      return `${repScheme.reps} reps`;
    case "range":
      return `${repScheme.min}-${repScheme.max} reps`;
    case "time":
      return `${repScheme.seconds} s`;
    case "amrap":
      return "AMRAP";
  }
}

function formatIntensity(intensity: ExecutableIntensity): string {
  switch (intensity.type) {
    case "rpe":
      return `RPE ${intensity.target}`;
    case "rir":
      return `RIR ${intensity.target}`;
    case "percent_1rm":
      return `${intensity.value}% 1RM`;
    case "fixed_load_kg":
      return `${intensity.value} kg`;
    case "training_max_percent":
      return `${intensity.value}% TM`;
    case "bodyweight":
      return "Poids de corps";
  }
}

export interface ExecutablePrescriptionCardProps {
  prescription: ExecutablePrescription;
}

/**
 * The athlete's exact, executable prescription for today — sets/reps/%, or
 * drills/runs/cues — sourced from the canonical generated plan
 * (training_plan_planned_prescriptions). This component never checks
 * `decision` itself — the caller (DailyPlanView) only ever renders it when
 * `decision === "KEEP"` AND a prescription is actually present (V0.5_048
 * lock), the same "the caller decides visibility, the component just
 * renders what it's given" discipline as every other card in this feature.
 */
export function ExecutablePrescriptionCard({ prescription }: ExecutablePrescriptionCardProps) {
  const { structure } = prescription;

  return (
    <PlanSection title="Exercices">
      {structure.domain === "strength" ? (
        <ul className="flex flex-col gap-3">
          {structure.blocks.map((block, index) => (
            <li key={index} className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
              {ROLE_LABELS[block.role] && <p className="text-xs uppercase tracking-wide text-muted">{ROLE_LABELS[block.role]}</p>}
              <p className="font-medium text-ink">{humanizeId(block.exerciseId)}</p>
              <p className="text-ink/80">
                {block.sets} × {formatRepScheme(block.repScheme)} — {formatIntensity(block.intensity)}
              </p>
              <p className="text-sm text-muted">Repos : {block.restSeconds} s</p>
              {block.tempo && <p className="text-sm text-muted">Tempo : {block.tempo}</p>}
              {block.unilateral && <p className="text-sm text-muted">Unilatéral</p>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-3">
          {structure.drills.map((drill, index) => (
            <li key={index} className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
              <p className="font-medium text-ink">{humanizeId(drill.drillId)}</p>
              <p className="text-xs uppercase tracking-wide text-muted">
                {humanizeId(drill.skillTarget)} · {humanizeId(drill.terrainRequirement)}
              </p>
              <p className="text-ink/80">{drill.runs} passages</p>
              <p className="text-sm text-ink/70">{drill.executionCue}</p>
              <p className="text-sm text-muted">Réussite : {drill.successCriterion}</p>
              {drill.progressionCondition && <p className="text-sm text-muted">Progression : {drill.progressionCondition}</p>}
              {drill.regressionCondition && <p className="text-sm text-muted">Régression : {drill.regressionCondition}</p>}
            </li>
          ))}
        </ul>
      )}
    </PlanSection>
  );
}
