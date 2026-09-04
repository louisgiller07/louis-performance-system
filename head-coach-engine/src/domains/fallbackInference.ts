import type { TrainingIntervention } from "../types/trainingIntervention.js";

/**
 * Fallback d'inférence — utilisé UNIQUEMENT quand `planned_session = null` ET
 * qu'aucune recommandation de protocole T-X n'est applicable. Voir
 * docs/03_COACHING_MODEL.md §7 (fallback) et docs/10_TEST_PLAN.md T6.1.
 *
 * V0.3_004A — générique, plus de split hebdomadaire personnel. Avant ce
 * jalon, cette fonction retournait un split spécifique à Louis
 * (docs/02_ATHLETE_PROFILE.md §4.1), qui se serait appliqué tel quel à
 * n'importe quel autre athlète. V0.3_003 donne désormais à chaque athlète
 * un vrai chemin explicite pour planifier ses séances (`/plan`) : le rôle
 * de ce fallback se réduit donc à "aucune séance planifiée, valeur de repli
 * sûre et générique" plutôt qu'à "deviner le planning personnel de
 * l'athlète". `RECOVERY_ACTIVE` est repris tel quel de l'ancien filet de
 * sécurité de cette même fonction (le cas hors-plage, jamais atteint avant
 * ce jalon car les 7 jours ISO étaient tous couverts).
 *
 * Ne tient PAS compte des soft constraints de mode (`no_development`, etc.) :
 * seule SAFETY est hard, et une soft constraint `strong` reste une
 * recommandation arbitrable, pas une interdiction automatique — voir
 * docs/11_DECISION_LOG.md 2026-08-13. Une éventuelle tension entre le mode
 * courant et la séance inférée est un arbitrage normal, pas un cas à
 * résoudre silencieusement ici.
 */
export function inferFallbackSession(_today: string): TrainingIntervention {
  return { kind: "RECOVERY_ACTIVE" };
}
