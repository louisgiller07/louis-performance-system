import type { TrainingIntervention } from "../types/trainingIntervention.js";
import { isoWeekday } from "../engine/dateUtils.js";

/**
 * Fallback d'inférence — utilisé UNIQUEMENT quand `planned_session = null` ET
 * qu'aucune recommandation de protocole T-X n'est applicable. Voir
 * docs/03_COACHING_MODEL.md §7 (fallback) et docs/10_TEST_PLAN.md T6.1.
 *
 * Split hebdomadaire PROVISIONAL basé sur le split cible déclaré par Louis
 * (docs/02_ATHLETE_PROFILE.md §4.1 : "Lun haut / Mar bas / Mer pumptrack /
 * Jeu cardio / Ven repos ou léger ou DH / Sam DH / Dim DH"). Aucune donnée
 * inventée — reprend le split déclaré, pas le split réel dévié récent.
 *
 * Ne tient PAS compte des soft constraints de mode (`no_development`, etc.) :
 * seule SAFETY est hard, et une soft constraint `strong` reste une
 * recommandation arbitrable, pas une interdiction automatique — voir
 * docs/11_DECISION_LOG.md 2026-08-13. Une éventuelle tension entre le mode
 * courant et la séance inférée est un arbitrage normal, pas un cas à
 * résoudre silencieusement ici.
 */
const WEEKDAY_SPLIT: Record<number, TrainingIntervention> = {
  0: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, // lundi
  1: { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, // mardi
  2: { kind: "PUMPTRACK", load_profile: "LIGHT" }, // mercredi
  3: { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, // jeudi
  4: { kind: "RECOVERY_ACTIVE" }, // vendredi
  5: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, // samedi
  6: { kind: "DH_TECHNICAL", load_profile: "MODERATE" }, // dimanche
};

export function inferFallbackSession(today: string): TrainingIntervention {
  const weekday = isoWeekday(today);
  return WEEKDAY_SPLIT[weekday] ?? { kind: "RECOVERY_ACTIVE" };
}
