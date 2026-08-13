import type { AthleteDimensions } from "../types/dimensions.js";

/**
 * global_readiness_ui — score agrégé 0-1 destiné à l'INTERFACE uniquement.
 * Ne doit JAMAIS être utilisé comme entrée d'une règle de décision — voir
 * docs/04_DAILY_DECISION_ENGINE.md §1 et docs/07_GLOSSARY.md.
 */
export function computeGlobalReadinessUi(dimensions: AthleteDimensions): number {
  const scores = [
    dimensions.systemic.score,
    dimensions.legs.score,
    dimensions.arms_grip.score,
    dimensions.mental.score,
    dimensions.health.score,
    dimensions.recent_load.score,
  ];
  const sum = scores.reduce((acc, s) => acc + s, 0);
  return Math.round((sum / scores.length) * 100) / 100;
}
