import type { TrainingIntervention, TrainingInterventionKind } from "../types/trainingIntervention.js";
import type { UpcomingRace } from "../types/context.js";
import type { DimensionLevel } from "../types/dimensions.js";
import type { DhTechnicalSection } from "../types/dailyPlan.js";
import { daysBetween } from "../engine/dateUtils.js";
import { TECHNIQUE_POLICY } from "../config/techniquePolicy.js";

const TECHNIQUE_ACTIVE_KINDS: ReadonlySet<TrainingInterventionKind> = new Set([
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
]);

/**
 * C1.5 — course dans la fenêtre TECHNIQUE_POLICY.raceProximityWindowDays
 * (1..N jours après `today`, inclusif). Jour 0 (aujourd'hui) et toute
 * course passée sont explicitement exclus — voir docs/06_ARCHITECTURE.md
 * §V0.3_002. N'utilise PAS EventContext.PRE_EVENT (fenêtre différente,
 * 7 jours, voir engine/eventContext.ts).
 */
function isRaceProximate(today: string, races: readonly UpcomingRace[]): boolean {
  return races.some((race) => {
    const delta = daysBetween(today, race.event_start);
    return delta >= 1 && delta <= TECHNIQUE_POLICY.raceProximityWindowDays;
  });
}

/** C1.4/C1.5/C1.6 — allowlist exact à 4 chaînes, jamais de venue nommée. */
function selectSpotHint(fatigueAmber: boolean, raceProximate: boolean): string {
  if (raceProximate && fatigueAmber) {
    return "Terrain représentatif de la prochaine course, à faible coût logistique.";
  }
  if (raceProximate) {
    return "Terrain représentatif de la prochaine course.";
  }
  if (fatigueAmber) {
    return "Terrain proche, à faible coût logistique.";
  }
  return "Terrain adapté au focus technique du jour.";
}

/**
 * Couche C — Domaine Technique DH (V0.3_002B). Voir
 * docs/06_ARCHITECTURE.md §V0.3_002.
 *
 * Ne consomme JAMAIS de signal via SignalTrace : `systemicLevel`/
 * `legsLevel`/`armsGripLevel` sont lus comme contexte descriptif
 * non-causal uniquement (Option C, propriété de signal) — jamais comme
 * cause d'une adaptation nécessitant `consume()`. Aucune interaction avec
 * SignalTrace.has()/consumedByRule() non plus : ce domaine n'a aujourd'hui
 * aucun besoin de coaching de support sur un signal déjà consommé
 * ailleurs.
 *
 * `finalSession` doit être la séance déjà entièrement arbitrée (après
 * règles de domaine, douleur non-SAFETY, soft constraints et A5) —
 * jamais le `planned_session` brut.
 *
 * `personalFocus` (V0.3_004A) est une entrée pure — le focus technique
 * personnel de l'athlète, lu par l'appelant depuis
 * `RawContext.coaching_profile.technique_primary_focus`, jamais consulté
 * ici depuis une config globale. Absent (athlète sans focus configuré) :
 * `focus` est simplement omis du résultat — jamais de valeur générique
 * fabriquée à sa place. `DhTechnicalSection.focus` est déjà optionnel,
 * aucun changement de schéma requis.
 */
export function computeTechniqueDomain(params: {
  finalSession: TrainingIntervention;
  today: string;
  upcomingRaces: readonly UpcomingRace[];
  systemicLevel: DimensionLevel;
  legsLevel: DimensionLevel;
  armsGripLevel: DimensionLevel;
  personalFocus?: string;
}): DhTechnicalSection {
  const { finalSession, today, upcomingRaces, systemicLevel, legsLevel, armsGripLevel, personalFocus } = params;

  if (!TECHNIQUE_ACTIVE_KINDS.has(finalSession.kind)) {
    return { active: false };
  }

  const fatigueAmber = systemicLevel === "AMBER" || legsLevel === "AMBER" || armsGripLevel === "AMBER";
  const raceProximate = isRaceProximate(today, upcomingRaces);

  return {
    active: true,
    ...(personalFocus !== undefined ? { focus: personalFocus } : {}),
    spot_hint: selectSpotHint(fatigueAmber, raceProximate),
  };
}
