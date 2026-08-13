// Voir docs/07_GLOSSARY.md §Traçabilité.
export type RuleLayer = "A" | "B" | "C" | "ARBITRATION";

export interface TriggeredRule {
  layer: RuleLayer;
  rule_id: string;
  detail: string;
  signals_used?: string[];
}
