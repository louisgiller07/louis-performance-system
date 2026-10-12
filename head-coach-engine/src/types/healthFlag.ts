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
  /** P0-SAFE — "YYYY-MM-DD" the signal was declared; optional (fixtures and legacy readers may omit it). */
  flag_date?: string;
}

export interface HealthFlagToCreate {
  type: HealthFlagType;
  reason: string;
}
