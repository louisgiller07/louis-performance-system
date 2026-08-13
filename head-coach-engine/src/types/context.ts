import type { TrainingIntervention } from "./trainingIntervention.js";
import type { ActiveExperiment } from "./experiment.js";

// Voir docs/07_GLOSSARY.md §Modes opérationnels et docs/05_DATA_MODEL.md §training_blocks.
export type TrainingMode =
  | "RACE_WEEK"
  | "RACE_CLUSTER"
  | "OFF_SEASON_RECOVERY"
  | "OFF_SEASON_DEVELOPMENT"
  | "PRE_SEASON"
  | "IN_SEASON"
  | "INJURY_RECOVERY"
  | "OTHER";

export type SoftConstraintWeight = "strong" | "moderate" | "weak";

/**
 * SoftConstraint — voir docs/07_GLOSSARY.md. Même `strong` reste soft :
 * dérogation possible avec `override_reason` loggée. Seule la couche A
 * (SAFETY) produit des contraintes hard.
 */
export interface SoftConstraint {
  type: string;
  reason: string;
  weight: SoftConstraintWeight;
}

export type RacePriority = "A_PLUS" | "A" | "B" | "C";

export type RaceFormat = "HOT_TRAIL_2DAY" | "IXS_3DAY" | "SWISS_CUP" | "UCI_WC" | "UCI_WORLDS" | "OTHER";

export type RacePhase =
  | "PRE_EVENT"
  | "TRACKWALK"
  | "PRACTICE"
  | "PRACTICE_TIMED"
  | "QUALI"
  | "FINAL"
  | "RACE_DAY_GENERIC"
  | "POST_EVENT";

export interface UpcomingRace {
  event_name: string;
  event_start: string; // ISO date
  event_end: string; // ISO date
  priority: RacePriority;
  race_format: RaceFormat;
  /** Phase officielle connue pour le jour courant, si disponible. Prime sur le mapping T-X générique. */
  race_phase?: RacePhase;
}

export interface EventContext {
  race: UpcomingRace;
  days_to_event: number; // jours jusqu'à event_start (négatif si passé)
  days_from_event: number; // jours depuis event_start (positif si en cours ou passé)
  event_day: number | null; // 0, 1, 2... si en cours, null sinon
  in_progress: boolean; // event_start <= today <= event_end
  phase: RacePhase;
}

export interface WeeklyAvailability {
  monday_evening: boolean;
  tuesday_evening: boolean;
  wednesday_evening: boolean;
  thursday_evening: boolean;
  friday_afternoon: boolean;
  saturday_full: boolean;
  sunday_full: boolean;
  week_context?: string;
  travel?: boolean;
}

export interface LifeConstraints {
  traveling?: boolean;
  school_week?: boolean;
  notes?: string;
}

export interface TrainingBlockRef {
  id: string;
  mode: TrainingMode;
  focus?: string;
}

/**
 * ContextState — structuré, PAS une DimensionState (pas de score GREEN/AMBER/RED).
 * Voir docs/04_DAILY_DECISION_ENGINE.md §1 et docs/07_GLOSSARY.md.
 */
export interface ContextState {
  current_block?: TrainingBlockRef;
  training_mode: TrainingMode;
  planned_session: TrainingIntervention | null;
  planned_intent?: string;
  availability?: WeeklyAvailability;
  event_context?: EventContext;
  active_experiments: ActiveExperiment[];
  life_constraints?: LifeConstraints;
}
