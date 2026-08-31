// Presentation-only grouping of the 15 athlete-plannable kinds, for the
// /plan session <select>'s <optgroup> layout. NEVER the source of truth
// for what is plannable — that remains PLANNABLE_KINDS (planningTypes.ts,
// itself built from PLANNABLE_LOAD_VARIABLE_KINDS/PLANNABLE_FIXED_LOAD_KINDS).
// planningKindGroups.test.ts regresses that this grouping never drifts from
// that canonical set (no omission, no duplicate, no RACE_ACTIVITY).
import type { TrainingInterventionKind } from "./planningTypes";

export interface PlanningKindGroup {
  label: string;
  kinds: readonly TrainingInterventionKind[];
}

export const PLANNING_KIND_GROUPS: readonly PlanningKindGroup[] = [
  { label: "DH / vélo", kinds: ["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT", "PUMPTRACK", "BIKE_MAINTENANCE"] },
  { label: "Force", kinds: ["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER", "GRIP_WORK"] },
  { label: "Aérobie", kinds: ["AEROBIC_BASE", "AEROBIC_INTERVALS"] },
  { label: "Récupération", kinds: ["MOBILITY", "RECOVERY_ACTIVE", "REST"] },
];
