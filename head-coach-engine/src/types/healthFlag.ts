// Voir docs/07_GLOSSARY.md §Health et docs/11_DECISION_LOG.md
// (active_health_flags structuré — pas simple count).
export type HealthFlagType =
  | "concussion_suspect"
  | "injury_suspect"
  | "illness"
  | "pain_persistent";

export type HealthFlagStatus = "active" | "monitoring" | "resolved";

export interface HealthFlag {
  type: HealthFlagType;
  status: HealthFlagStatus;
}

export interface HealthFlagToCreate {
  type: HealthFlagType;
  reason: string;
}
