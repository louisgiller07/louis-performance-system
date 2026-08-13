import type { TrainingIntervention } from "../types/trainingIntervention.js";
import type { DbSessionType } from "../types/dbSessionType.js";

/**
 * Mapping TrainingIntervention → DbSessionType — fonction pure et
 * déterministe. Voir docs/05_DATA_MODEL.md §Mapping vers DbSessionType
 * (table de mapping canonique) et docs/06_ARCHITECTURE.md.
 *
 * Aucune décision de coaching ici — mapping seulement. Pour tout couple
 * `(kind, load_profile)` valide, la sortie est unique.
 */
export function mapTrainingInterventionToDbSessionType(intervention: TrainingIntervention): DbSessionType {
  switch (intervention.kind) {
    case "STRENGTH_LOWER":
      return intervention.load_profile === "LIGHT" ? "STRENGTH_B" : "STRENGTH_A";
    case "STRENGTH_UPPER":
      return intervention.load_profile === "HEAVY" ? "STRENGTH_A" : "STRENGTH_B";
    case "POWER":
      return intervention.load_profile === "HEAVY" ? "STRENGTH_A" : "STRENGTH_B";
    case "GRIP_WORK":
      return intervention.load_profile === "HEAVY" ? "STRENGTH_A" : "STRENGTH_B";
    case "STRENGTH_FULL_LIGHT":
      return "STRENGTH_B";
    case "AEROBIC_BASE":
      return "AEROBIC_BASE";
    case "AEROBIC_INTERVALS":
      return "AEROBIC_INTERVALS";
    case "DH_TECHNICAL":
      return "DH_TECHNICAL";
    case "PUMPTRACK":
      return "DH_TECHNICAL";
    case "DH_PERFORMANCE":
      return "DH_PERFORMANCE";
    case "DH_LIGHT":
      return "RECOVERY";
    case "MOBILITY":
      return "RECOVERY";
    case "RECOVERY_ACTIVE":
      return "RECOVERY";
    case "REST":
      return "REST";
    case "BIKE_MAINTENANCE":
      return "BIKE_MAINTENANCE";
    case "RACE_ACTIVITY":
      return "RACE_PREP";
  }
}
