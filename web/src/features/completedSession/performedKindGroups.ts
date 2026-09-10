// Presentation-only grouping of the 16 performable kinds, for the rich
// performed-activity <select>'s <optgroup> layout — mirrors
// planning/planningKindGroups.ts's grouping exactly, plus a "Course" group
// for RACE_ACTIVITY (never plannable, but a valid performed reality — see
// performedInterventionTypes.ts). NEVER the source of truth for what is a
// valid performed kind — that remains PERFORMED_FIXED_LOAD_KINDS/
// PERFORMED_LOAD_VARIABLE_KINDS.
import type { TrainingInterventionKind } from "./performedInterventionTypes";

export interface PerformedKindGroup {
  label: string;
  kinds: readonly TrainingInterventionKind[];
}

export const PERFORMED_KIND_GROUPS: readonly PerformedKindGroup[] = [
  { label: "DH / vélo", kinds: ["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT", "PUMPTRACK", "BIKE_MAINTENANCE"] },
  { label: "Course", kinds: ["RACE_ACTIVITY"] },
  { label: "Force", kinds: ["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "POWER", "GRIP_WORK"] },
  { label: "Aérobie", kinds: ["AEROBIC_BASE", "AEROBIC_INTERVALS"] },
  { label: "Récupération", kinds: ["MOBILITY", "RECOVERY_ACTIVE", "REST"] },
];
