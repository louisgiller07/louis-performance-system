import type { TrainingIntervention, TrainingInterventionKind } from "../types/trainingIntervention.js";
import type { UpcomingRace } from "../types/context.js";
import type { DimensionLevel } from "../types/dimensions.js";
import type { DhTechnicalSection } from "../types/dailyPlan.js";
import type { ZoneCategory } from "../rules/painNonSafety.js";
import { daysBetween } from "../engine/dateUtils.js";
import { TECHNIQUE_POLICY } from "../config/techniquePolicy.js";
import { DH_SPOT_HINT } from "../config/sessionPrescriptionPolicy.js";
import { resolveDhFocus, resolveDhExecutionTask, resolveDhLoadGuidance } from "./dhPrescription.js";

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

/**
 * V0.3_006C1 (final fatigue-terrain check) — "fatigue significative" pour le
 * terrain couvre AMBER **et** RED (systemic/legs/arms_grip) — jamais AMBER
 * seul. Une fatigue RED aboutit souvent à une session déjà réduite par
 * Training (ex. pivot vers DH_LIGHT/LIGHT, C3.5/C3.6) mais celle-ci reste
 * DH-family : le terrain doit donc aussi refléter la demande réduite,
 * jamais retomber sur le terrain frais/course par défaut simplement parce
 * que la fatigue a atteint RED plutôt que AMBER. Ne touche ni les seuils
 * GREEN/AMBER/RED eux-mêmes (calculés en amont, inchangés) ni l'arbitrage
 * Training (downgrade de charge, pivot de kind, C3.3/C3.5/C3.6) — seule la
 * sélection de terrain change. Voir docs/03_COACHING_MODEL.md §C1.6.
 *
 * V0.3_006C1 — précédence déterministe (docs/03_COACHING_MODEL.md §Terrain) :
 * douleur non-SAFETY constrainante > fatigue significative > Mental RED >
 * proximité course > frais/défaut. Une seule recommandation gagnante,
 * jamais de concaténation de plusieurs recommandations concurrentes.
 * Toujours une caractéristique de terrain descriptive (jamais un nom de
 * spot réel, jamais GPS/base de données de spots) — allowlist fixe de
 * chaînes, voir sessionPrescriptionPolicy.ts#DH_SPOT_HINT. Les deux
 * variantes douleur restent un langage générique de réduction de
 * sollicitation mécanique — jamais une affirmation de sécurité médicale
 * pour une zone donnée.
 */
function selectSpotHint(params: {
  painZoneCategory: ZoneCategory | undefined;
  meaningfulFatigue: boolean;
  mentalRed: boolean;
  raceProximate: boolean;
}): string {
  const { painZoneCategory, meaningfulFatigue, mentalRed, raceProximate } = params;

  if (painZoneCategory === "upper_grip") return DH_SPOT_HINT.painUpperGrip;
  if (painZoneCategory === "lower") return DH_SPOT_HINT.painLower;
  if (meaningfulFatigue) return DH_SPOT_HINT.fatigue;
  if (mentalRed) return DH_SPOT_HINT.mentalRed;
  if (raceProximate) return DH_SPOT_HINT.raceProximate;
  return DH_SPOT_HINT.freshDefault;
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
 * V0.3_006B (Session Prescription V1) — `resolveDhFocus` (dhPrescription.ts)
 * retombe sur un focus générique par kind (`DH_GENERIC_FOCUS`), jamais
 * présenté comme une personnalisation apprise. `focus` est donc désormais
 * toujours présent pour un kind DH-family. `DhTechnicalSection.focus` reste
 * optionnel côté type (inchangé), simplement toujours renseigné en
 * pratique pour ce chemin.
 *
 * `load_guidance` (V0.3_006C1, final correction) est dérivé de
 * `finalSession.load_profile` — substantiel (comportement de conduite),
 * donc désormais émis/persisté par le moteur plutôt que recalculé par le
 * web à partir de `load_profile` seul (voir dhPrescription.ts#resolveDhLoadGuidance
 * et docs/03_COACHING_MODEL.md §DH Execution Guidance — invariant d'historique).
 *
 * `painZoneCategory`/`mentalRed` (V0.3_006C1) sont, comme `systemicLevel`/
 * `legsLevel`/`armsGripLevel`, lus comme contexte descriptif non-causal
 * uniquement — aucune interaction SignalTrace nouvelle, ce domaine ne
 * consomme toujours aucun signal. `painZoneCategory` vient de
 * `PainNonSafetyResult.zone_category` (rules/painNonSafety.ts, déjà
 * calculé par l'appelant), jamais recalculé ici.
 */
export function computeTechniqueDomain(params: {
  finalSession: TrainingIntervention;
  today: string;
  upcomingRaces: readonly UpcomingRace[];
  systemicLevel: DimensionLevel;
  legsLevel: DimensionLevel;
  armsGripLevel: DimensionLevel;
  personalFocus?: string;
  painZoneCategory?: ZoneCategory;
  mentalRed?: boolean;
}): DhTechnicalSection {
  const { finalSession, today, upcomingRaces, systemicLevel, legsLevel, armsGripLevel, personalFocus, painZoneCategory, mentalRed } = params;

  if (!TECHNIQUE_ACTIVE_KINDS.has(finalSession.kind)) {
    return { active: false };
  }

  const isMeaningfulFatigueLevel = (level: DimensionLevel): boolean => level === "AMBER" || level === "RED";
  const meaningfulFatigue =
    isMeaningfulFatigueLevel(systemicLevel) || isMeaningfulFatigueLevel(legsLevel) || isMeaningfulFatigueLevel(armsGripLevel);
  const raceProximate = isRaceProximate(today, upcomingRaces);
  const focus = resolveDhFocus(finalSession.kind, personalFocus);
  const executionTask = resolveDhExecutionTask(finalSession.kind, personalFocus);
  const loadGuidance = resolveDhLoadGuidance(finalSession.kind, finalSession.load_profile);
  const relevantPainZone = painZoneCategory === "upper_grip" || painZoneCategory === "lower" ? painZoneCategory : undefined;

  return {
    active: true,
    ...(focus !== undefined ? { focus } : {}),
    ...(executionTask !== undefined ? { execution_task: executionTask } : {}),
    ...(loadGuidance !== undefined ? { load_guidance: loadGuidance } : {}),
    spot_hint: selectSpotHint({ painZoneCategory: relevantPainZone, meaningfulFatigue, mentalRed: mentalRed === true, raceProximate }),
  };
}
