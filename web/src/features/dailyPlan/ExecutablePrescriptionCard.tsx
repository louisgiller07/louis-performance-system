import { PlanSection } from "../../components/PlanSection";
import type { ExecutableIntensity, ExecutablePrescription, ExecutableRepScheme } from "./dailyPlanTypes";
import { formatRepetitionRange, formatRepetitions, translateSkill, translateTerrain } from "../trainingLabels/trainingLabels";
// REV-015.3 — French exercise/drill names by catalogue id; an unknown id shows the neutral label, never the id.
import { translateDrill, translateExercise, UNKNOWN_DRILL_LABEL, UNKNOWN_EXERCISE_LABEL } from "../trainingLabels/exerciseLabels";
// REV-015.4b — French drill instruction/criterion only when the stored English matches its known source; otherwise the stored text is kept.
import { translateDrillExecutionCue, translateDrillSuccessCriterion } from "../trainingLabels/drillInstructionLabels";

/** REV-015.2 — "Freinage · Sentier aménagé"; an unknown skill/terrain is left out, never shown raw. `null` when neither is known. */
function formatDrillContext(skillTarget: string, terrainRequirement: string): string | null {
  const parts = [translateSkill(skillTarget), translateTerrain(terrainRequirement)].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const ROLE_LABELS: Record<string, string> = {
  warm_up: "Échauffement",
  work: "Travail",
  accessory: "Accessoire",
};


function formatRepScheme(repScheme: ExecutableRepScheme): string {
  switch (repScheme.type) {
    case "fixed":
      return formatRepetitions(repScheme.reps);
    case "range":
      return formatRepetitionRange(repScheme.min, repScheme.max);
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
              <p className="font-medium text-ink">{translateExercise(block.exerciseId) ?? UNKNOWN_EXERCISE_LABEL}</p>
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
              <p className="font-medium text-ink">{translateDrill(drill.drillId) ?? UNKNOWN_DRILL_LABEL}</p>
              {formatDrillContext(drill.skillTarget, drill.terrainRequirement) && (
                <p className="text-xs uppercase tracking-wide text-muted">{formatDrillContext(drill.skillTarget, drill.terrainRequirement)}</p>
              )}
              <p className="text-ink/80">{drill.runs} passages</p>
              {translateDrillExecutionCue(drill.drillId, drill.executionCue) && (
                <p className="text-sm text-ink/70">{translateDrillExecutionCue(drill.drillId, drill.executionCue)}</p>
              )}
              {translateDrillSuccessCriterion(drill.drillId, drill.successCriterion) && (
                <p className="text-sm text-muted">Réussite : {translateDrillSuccessCriterion(drill.drillId, drill.successCriterion)}</p>
              )}
              {drill.progressionCondition && <p className="text-sm text-muted">Progression : {drill.progressionCondition}</p>}
              {drill.regressionCondition && <p className="text-sm text-muted">Régression : {drill.regressionCondition}</p>}
            </li>
          ))}
        </ul>
      )}
    </PlanSection>
  );
}
