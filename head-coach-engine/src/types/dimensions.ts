/**
 * Six dimensions canoniques — voir docs/07_GLOSSARY.md §Concepts métier.
 * `context` n'est PAS une dimension : voir ContextState dans context.ts.
 */
export type DimensionLevel = "GREEN" | "AMBER" | "RED";

export interface DimensionState {
  level: DimensionLevel;
  score: number;
  raw_signals: string[];
  reasons: string[];
}

export interface AthleteDimensions {
  systemic: DimensionState;
  legs: DimensionState;
  arms_grip: DimensionState;
  mental: DimensionState;
  health: DimensionState;
  recent_load: DimensionState;
}
