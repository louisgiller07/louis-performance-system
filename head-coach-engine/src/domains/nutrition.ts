import type { TrainingIntervention, TrainingInterventionKind } from "../types/trainingIntervention.js";
import type { EventContext, TrainingMode } from "../types/context.js";
import type { NutritionSection } from "../types/dailyPlan.js";
import { NUTRITION_POLICY } from "../config/nutritionPolicy.js";

const DH_KINDS: ReadonlySet<TrainingInterventionKind> = new Set([
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
]);

const STRENGTH_KINDS: ReadonlySet<TrainingInterventionKind> = new Set([
  "STRENGTH_LOWER",
  "STRENGTH_UPPER",
  "STRENGTH_FULL_LIGHT",
  "POWER",
  "GRIP_WORK",
]);

/** Formatage décimal français minimal ("3.5" → "3,5") — pas d'infrastructure de localisation. */
function formatFrenchDecimal(value: number): string {
  return String(value).replace(".", ",");
}

// Textes interpolés depuis NUTRITION_POLICY — les quatre valeurs
// numériques canoniques pilotent réellement le texte rendu, aucune copie
// numérique dupliquée ici (évite toute dérive entre la config et le texte).
const RACE_WEEK_FOCUS = "En race week : pense à augmenter légèrement l'apport énergétique.";
const RACE_DAY_NOTES = `Jour de course : petit-déjeuner consistant au moins ${NUTRITION_POLICY.raceBreakfastLeadHours} h avant le premier run.`;
const DH_DAY_NOTES = `Jour DH : vise environ ${NUTRITION_POLICY.dhHydrationRangeL.min} à ${formatFrenchDecimal(NUTRITION_POLICY.dhHydrationRangeL.max)} L sur la journée.`;
const STRENGTH_NOTES = `Séance de force planifiée : protéines + glucides dans les ${NUTRITION_POLICY.strengthPostWindowMinutes} minutes après.`;

/**
 * Couche C — Domaine Nutrition (V0.3_002D). Voir docs/06_ARCHITECTURE.md §V0.3_002.
 *
 * `focus` (rappel race-week) et le couple `notes`/`hydration_target_l`
 * (branche primaire) sont dérivés indépendamment — jamais l'un n'efface
 * l'autre. La branche primaire suit une précédence déterministe explicite :
 * RACE DAY > DH DAY > SÉANCE DE FORCE PLANIFIÉE > aucune.
 *
 * `event_context.in_progress` (pas `phase === "RACE_DAY_GENERIC"`) pour
 * rester valide même si une `race_phase` granulaire est un jour curée.
 * `finalSession` (séance déjà arbitrée) pour le jour DH — l'hydratation
 * doit suivre ce qui se passe réellement. `plannedSession` (brute, jamais
 * `finalSession`) pour la séance de force — le moteur ne connaît pas
 * l'exécution/complétion de la séance à ce stade (voir portée verrouillée).
 *
 * Aucune interaction `SignalTrace`, aucune `TriggeredRule` : aucune
 * heuristique C5.x ne consomme un signal de dimension, toutes sont
 * purement contextuelles (mode, nature de séance, présence de course).
 */
export function computeNutritionDomain(params: {
  finalSession: TrainingIntervention;
  plannedSession: TrainingIntervention | null;
  activeMode: TrainingMode;
  eventContext?: EventContext;
}): NutritionSection {
  const { finalSession, plannedSession, activeMode, eventContext } = params;

  const focus = activeMode === "RACE_WEEK" ? RACE_WEEK_FOCUS : undefined;

  let notes: string | undefined;
  let hydrationTargetL: number | undefined;

  if (eventContext?.in_progress) {
    notes = RACE_DAY_NOTES;
  } else if (DH_KINDS.has(finalSession.kind)) {
    notes = DH_DAY_NOTES;
  } else if (plannedSession && STRENGTH_KINDS.has(plannedSession.kind)) {
    notes = STRENGTH_NOTES;
    hydrationTargetL = NUTRITION_POLICY.baselineHydrationTargetL;
  }

  if (focus === undefined && notes === undefined && hydrationTargetL === undefined) {
    return { active: false };
  }

  const section: NutritionSection = { active: true };
  if (focus !== undefined) section.focus = focus;
  if (hydrationTargetL !== undefined) section.hydration_target_l = hydrationTargetL;
  if (notes !== undefined) section.notes = notes;
  return section;
}
