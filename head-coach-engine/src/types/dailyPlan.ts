import type { TrainingMode, EventContext } from "./context.js";
import type { TrainingIntervention } from "./trainingIntervention.js";
import type { TriggeredRule } from "./triggeredRule.js";
import type { HealthFlagToCreate } from "./healthFlag.js";

// Confidence qualitative — voir docs/04_DAILY_DECISION_ENGINE.md §6 et
// docs/11_DECISION_LOG.md (2026-08-11 — Confidence qualitative en V0.2).
// Tout score numérique de confidence est proscrit en V0.2.
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * Décision d'arbitrage KEEP/MODIFY/REPLACE/REST — voir
 * docs/04_DAILY_DECISION_ENGINE.md §5. Ce champ n'apparaît pas explicitement
 * dans le pseudo-schéma DailyPlan de la spec (implicite via comparaison
 * planned_session_before / final_session), mais docs/10_TEST_PLAN.md §T7
 * teste ces 4 libellés directement. Ajouté ici comme extension explicite
 * pour rendre l'arbitrage testable sans ambiguïté — voir résumé de session
 * pour Louis.
 */
export type ArbitrationDecision = "KEEP" | "MODIFY" | "REPLACE" | "REST";

export interface TrainingPlanSection {
  active: boolean;
  session_type?: TrainingIntervention;
  duration_min?: number;
  time_slot?: string;
  content_ref?: string;
  objective?: string;
}

export interface DhTechnicalSection {
  active: boolean;
  focus?: string;
  spot_hint?: string;
}

export interface MentalSection {
  active: boolean;
  focus?: string;
  action_hint?: string;
}

export interface RecoverySection {
  active: boolean;
  actions: string[];
}

export interface NutritionSection {
  active: boolean;
  focus?: string;
  hydration_target_l?: number;
  notes?: string;
}

export interface SleepSection {
  active: boolean;
  target_hours?: number;
  bedtime_hint?: string;
  notes?: string;
}

export interface ProtectionSection {
  do_not_do: string[];
}

export interface MonitoringSection {
  observe: string[];
}

/**
 * DailyPlan — sortie principale du moteur. Voir docs/04_DAILY_DECISION_ENGINE.md §6
 * et docs/07_GLOSSARY.md.
 */
export interface DailyPlan {
  date: string;
  active_mode: TrainingMode;
  event_context?: EventContext;

  training: TrainingPlanSection;
  dh_or_technical: DhTechnicalSection;
  mental: MentalSection;
  recovery: RecoverySection;
  nutrition: NutritionSection;
  sleep: SleepSection;
  protection: ProtectionSection;
  monitoring: MonitoringSection;

  reasoning: string;
  confidence: Confidence;

  triggered_rules: TriggeredRule[];
  health_flag_to_create?: HealthFlagToCreate;

  planned_session_before: TrainingIntervention | null;
  final_session: TrainingIntervention;
  decision: ArbitrationDecision;

  overrode_race_protocol: boolean;
  override_reason?: string;

  engine_version: string;
}
