// UI-only French labels. These never change or interpret the underlying
// value — a value not in a map falls back to itself (the raw enum string)
// rather than throwing, so an engine value added later still renders
// something instead of crashing.
import type { ArbitrationDecision, Confidence, LoadProfile, TrainingInterventionKind, TrainingMode, TrainingIntervention } from "./dailyPlanTypes";

export const DECISION_LABELS: Record<ArbitrationDecision, string> = {
  KEEP: "Maintenir",
  MODIFY: "Adapter",
  REPLACE: "Remplacer",
  REST: "Repos",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  LOW: "Faible",
  MEDIUM: "Moyenne",
  HIGH: "Élevée",
};

export const TRAINING_MODE_LABELS: Record<TrainingMode, string> = {
  RACE_WEEK: "Semaine de course",
  RACE_CLUSTER: "Enchaînement de courses",
  OFF_SEASON_RECOVERY: "Hors-saison — récupération",
  OFF_SEASON_DEVELOPMENT: "Hors-saison — développement",
  PRE_SEASON: "Pré-saison",
  IN_SEASON: "En saison",
  INJURY_RECOVERY: "Retour de blessure",
  OTHER: "Autre",
};

export const LOAD_PROFILE_LABELS: Record<LoadProfile, string> = {
  HEAVY: "charge lourde",
  MODERATE: "charge modérée",
  LIGHT: "charge légère",
};

export const TRAINING_KIND_LABELS: Record<TrainingInterventionKind, string> = {
  STRENGTH_LOWER: "Renfo bas du corps",
  STRENGTH_UPPER: "Renfo haut du corps",
  STRENGTH_FULL_LIGHT: "Renfo complet léger",
  POWER: "Puissance",
  GRIP_WORK: "Travail de préhension",
  AEROBIC_BASE: "Aérobie base",
  AEROBIC_INTERVALS: "Aérobie intervalles",
  DH_TECHNICAL: "DH technique",
  DH_PERFORMANCE: "DH performance",
  DH_LIGHT: "DH léger",
  PUMPTRACK: "Pumptrack",
  MOBILITY: "Mobilité",
  RECOVERY_ACTIVE: "Récupération active",
  REST: "Repos",
  BIKE_MAINTENANCE: "Entretien vélo",
  RACE_ACTIVITY: "Activité course",
};

/** "Pumptrack · charge légère" — used for both final_session and planned_session_before. */
export function formatIntervention(intervention: TrainingIntervention): string {
  const kindLabel = TRAINING_KIND_LABELS[intervention.kind] ?? intervention.kind;
  if (!intervention.load_profile) return kindLabel;
  return `${kindLabel} · ${LOAD_PROFILE_LABELS[intervention.load_profile] ?? intervention.load_profile}`;
}

/** Compares two interventions by kind + load_profile only (mirrors the engine's own sameIntervention, not imported to keep the M4_004 build boundary). */
export function isSameIntervention(a: TrainingIntervention | null, b: TrainingIntervention): boolean {
  if (!a) return false;
  return a.kind === b.kind && a.load_profile === b.load_profile;
}
