import type { DimensionState } from "../types/dimensions.js";
import type { EventContext } from "../types/context.js";
import type { MentalSection } from "../types/dailyPlan.js";
import type { TriggeredRule } from "../types/triggeredRule.js";
import type { SignalTrace } from "../engine/signalTrace.js";

const AMBER_STRESS_ACTION_HINT = "Fais quelques respirations lentes, puis reviens à une seule priorité.";
const AMBER_MOTIVATION_ACTION_HINT = "Choisis une seule action simple et commence par celle-là.";
const RED_SUPPORTIVE_ACTION_HINT =
  "Le plan du jour tient déjà compte de la charge mentale. Garde une seule priorité d'exécution.";

export interface MentalDomainResult {
  mental: MentalSection;
  triggeredRule?: TriggeredRule;
}

function buildMentalSection(focus: string | undefined, actionHint: string | undefined): MentalSection {
  if (focus === undefined && actionHint === undefined) {
    return { active: false };
  }
  const section: MentalSection = { active: true };
  if (focus !== undefined) section.focus = focus;
  if (actionHint !== undefined) section.action_hint = actionHint;
  return section;
}

/**
 * Couche C — Domaine Mental (V0.3_002C). Voir docs/06_ARCHITECTURE.md §V0.3_002.
 *
 * `focus` (cue pré-course) et `action_hint` (régulation AMBER / support RED)
 * sont des champs orthogonaux, dérivés indépendamment — jamais l'un
 * n'efface l'autre.
 *
 * Propriété de signal (Option C, verrouillée V0.3_002A) : en RED, la
 * dimension entière est propriété de décision de Training (`MENTAL_RED`,
 * training.ts) — Mental ne consomme JAMAIS `stress_high`/`motivation_low`
 * en RED, même si l'un des deux signaux reste techniquement non consommé
 * par Training (Training ne consomme jamais qu'un seul signal, par sa
 * propre précédence stress_high > motivation_low). Mental vérifie
 * uniquement la propriété via `SignalTrace.consumedByRule()` (lecture non
 * consommante) avant d'émettre le texte de support. En AMBER, Training ne
 * touche jamais ces signaux (garde `level === "RED"` stricte dans
 * training.ts) — Mental peut donc consommer librement, avec la même
 * précédence stress_high > motivation_low, exactement un signal par jour.
 */
// personalPreRaceCue (V0.3_004A): athlete's personal pre-race cue, read by
// the caller from RawContext.coaching_profile.mental_pre_race_cue — never
// looked up here from a global config. Absent -> focus stays undefined,
// never a fabricated generic cue; existing action_hint behavior unaffected.
export function computeMentalDomain(params: {
  mentalDimension: DimensionState;
  eventContext?: EventContext;
  signalTrace: SignalTrace;
  personalPreRaceCue?: string;
}): MentalDomainResult {
  const { mentalDimension, eventContext, signalTrace, personalPreRaceCue } = params;

  const focus = eventContext?.phase === "PRE_EVENT" ? personalPreRaceCue : undefined;

  let actionHint: string | undefined;
  let triggeredRule: TriggeredRule | undefined;

  if (mentalDimension.level === "RED") {
    const selectedSignal = mentalDimension.raw_signals.includes("stress_high") ? "stress_high" : "motivation_low";
    if (signalTrace.consumedByRule(selectedSignal) === "MENTAL_RED") {
      actionHint = RED_SUPPORTIVE_ACTION_HINT;
    }
    // Propriété non vérifiée (ne devrait pas arriver avec le code actuel) —
    // aucun texte de support fabriqué, action_hint reste undefined.
  } else if (mentalDimension.level === "AMBER") {
    if (mentalDimension.raw_signals.includes("stress_high")) {
      if (signalTrace.consume("stress_high", "MENTAL_AMBER_STRESS")) {
        actionHint = AMBER_STRESS_ACTION_HINT;
        triggeredRule = {
          layer: "C",
          rule_id: "MENTAL_AMBER_STRESS",
          detail: "Stress travail élevé — coaching mental de régulation (respiration, priorité unique)",
          signals_used: ["stress_high"],
        };
      }
      // consume() a échoué de façon inattendue — aucun repli sur
      // motivation_low, aucune règle causale fabriquée.
    } else if (mentalDimension.raw_signals.includes("motivation_low")) {
      if (signalTrace.consume("motivation_low", "MENTAL_AMBER_MOTIVATION")) {
        actionHint = AMBER_MOTIVATION_ACTION_HINT;
        triggeredRule = {
          layer: "C",
          rule_id: "MENTAL_AMBER_MOTIVATION",
          detail: "Motivation basse — coaching mental de régulation (action simple, priorité unique)",
          signals_used: ["motivation_low"],
        };
      }
    }
  }

  return { mental: buildMentalSection(focus, actionHint), triggeredRule };
}
