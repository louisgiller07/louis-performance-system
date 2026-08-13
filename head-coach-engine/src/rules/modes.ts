import type { SoftConstraint, TrainingMode } from "../types/context.js";
import type { TrainingIntervention } from "../types/trainingIntervention.js";
import { isFixedLoadIntervention } from "../types/trainingIntervention.js";

/**
 * Couche B — soft constraints par défaut par mode opérationnel.
 * Voir docs/04_DAILY_DECISION_ENGINE.md §3.
 */
export function getModeSoftConstraints(mode: TrainingMode): SoftConstraint[] {
  switch (mode) {
    case "RACE_WEEK":
      return [
        { type: "no_development", reason: "Race week — pas de développement physique", weight: "strong" },
        { type: "no_grip_heavy", reason: "Race week — protéger le grip pour la course", weight: "strong" },
        { type: "no_dh_intense", reason: "Race week — protéger la fraîcheur pour la course", weight: "strong" },
      ];
    case "RACE_CLUSTER":
      return [
        { type: "no_grip_heavy", reason: "Race cluster — gérer la fatigue grip cumulée", weight: "moderate" },
        { type: "protect_sleep", reason: "Race cluster — protéger la récupération entre courses", weight: "moderate" },
      ];
    case "OFF_SEASON_RECOVERY":
      return [{ type: "no_development", reason: "Off-season recovery — priorité à la récupération", weight: "moderate" }];
    case "INJURY_RECOVERY":
      return [
        { type: "no_development", reason: "Injury recovery — priorité à la guérison", weight: "strong" },
        { type: "no_dh_intense", reason: "Injury recovery — pas de DH intense", weight: "strong" },
      ];
    case "OFF_SEASON_DEVELOPMENT":
    case "PRE_SEASON":
    case "IN_SEASON":
    case "OTHER":
      return [];
  }
}

const DEVELOPMENT_KINDS = new Set([
  "STRENGTH_LOWER",
  "STRENGTH_UPPER",
  "POWER",
  "GRIP_WORK",
  "AEROBIC_INTERVALS",
  "DH_PERFORMANCE",
]);

/** Une séance "développement" = stimulus réel (HEAVY/MODERATE) sur un kind de progression. */
function isDevelopmentSession(session: TrainingIntervention): boolean {
  if (!DEVELOPMENT_KINDS.has(session.kind)) return false;
  if (isFixedLoadIntervention(session)) return false;
  return session.load_profile === "HEAVY" || session.load_profile === "MODERATE";
}

export interface StrongConstraintViolation {
  replacement: TrainingIntervention;
  reason: string;
  protectionNote: string;
}

/**
 * Décrit comment une soft constraint `strong` serait appliquée à `session` si
 * rien ne la justifie — voir `applyStrongModeConstraints` dans
 * `engine/buildDailyPlan.ts`. Retourne `null` si la contrainte n'est pas
 * concernée par cette séance (pas de violation).
 *
 * `strong` reste soft (docs/11_DECISION_LOG.md 2026-08-13, rounds 1 et 2) : cette
 * fonction ne fait que DÉCRIRE l'application par défaut de la contrainte —
 * elle ne décide pas elle-même si l'override est acceptable. C'est
 * l'orchestrateur qui choisit d'appliquer ou de conserver la séance
 * (justification via `planned_intent`), en traçant systématiquement le résultat.
 */
export function describeStrongConstraintViolation(
  constraint: SoftConstraint,
  session: TrainingIntervention,
): StrongConstraintViolation | null {
  switch (constraint.type) {
    case "no_grip_heavy":
      if (session.kind !== "GRIP_WORK") return null;
      return {
        replacement: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" },
        reason: "séance de grip incompatible avec la contrainte no_grip_heavy",
        protectionNote: "Éviter le travail de grip lourd (contrainte de mode)",
      };
    case "no_dh_intense":
      if (session.kind !== "DH_TECHNICAL" && session.kind !== "DH_PERFORMANCE") return null;
      return {
        replacement: { kind: "DH_LIGHT", load_profile: "LIGHT" },
        reason: "DH intense incompatible avec la contrainte no_dh_intense",
        protectionNote: "Éviter le DH intense (contrainte de mode)",
      };
    case "no_development":
      if (!isDevelopmentSession(session)) return null;
      return {
        replacement: { kind: "RECOVERY_ACTIVE" },
        reason: "séance de développement incompatible avec la contrainte no_development",
        protectionNote: "Pas de développement physique (contrainte de mode)",
      };
    default:
      return null;
  }
}
