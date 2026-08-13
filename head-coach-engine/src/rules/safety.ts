import type { DailyCheckin } from "../types/checkin.js";
import type { HealthFlag, HealthFlagToCreate } from "../types/healthFlag.js";
import type { TriggeredRule } from "../types/triggeredRule.js";

/**
 * Couche A — SAFETY RULES. Non-contournables, écrasent toutes les autres
 * couches. Voir docs/04_DAILY_DECISION_ENGINE.md §2 et
 * docs/03_COACHING_MODEL.md §6 (SAFETY limitée aux vraies règles médicales).
 *
 * `action`:
 *  - REST : arrêt complet, orientation médicale.
 *  - ZERO_DH : DH interdit tant que non validé médicalement, le reste du
 *    plan (physique hors DH, récupération) reste possible (A5 uniquement).
 */
export type SafetyAction = "REST" | "ZERO_DH";

export interface SafetyResult {
  rule_id: "A1" | "A2" | "A3" | "A4" | "A5";
  action: SafetyAction;
  health_flag_to_create?: HealthFlagToCreate;
  triggered_rule: TriggeredRule;
  reasoning: string;
}

export function evaluateSafety(checkin: DailyCheckin, activeHealthFlags: HealthFlag[]): SafetyResult | null {
  // A1 — Suspicion de commotion
  if (checkin.suspected_concussion) {
    return {
      rule_id: "A1",
      action: "REST",
      health_flag_to_create: { type: "concussion_suspect", reason: "Suspicion de commotion déclarée au checkin" },
      triggered_rule: {
        layer: "A",
        rule_id: "A1",
        detail: "Suspicion de commotion déclarée — REST et orientation médicale immédiate",
        signals_used: ["suspected_concussion"],
      },
      reasoning:
        "Suspicion de commotion cérébrale déclarée. Repos complet immédiat et consultation d'un professionnel de santé obligatoire avant tout retour à l'activité.",
    };
  }

  // A2 — Douleur nouvelle sévère (≥6/10)
  if (checkin.pain && checkin.pain_intensity >= 6 && checkin.pain_new) {
    return {
      rule_id: "A2",
      action: "REST",
      health_flag_to_create: {
        type: "injury_suspect",
        reason: `Douleur nouvelle sévère (${checkin.pain_intensity}/10)${checkin.pain_location_code ? ` — ${checkin.pain_location_code}` : ""}`,
      },
      triggered_rule: {
        layer: "A",
        rule_id: "A2",
        detail: `Douleur nouvelle ≥ 6/10 (${checkin.pain_intensity}/10) — REST et orientation médicale`,
        signals_used: ["pain_new_severe"],
      },
      reasoning:
        "Douleur nouvelle et sévère déclarée. Repos et consultation d'un professionnel de santé recommandée avant de reprendre l'entraînement.",
    };
  }

  // A3 — Fièvre / maladie déclarée
  if (checkin.fever_or_illness) {
    return {
      rule_id: "A3",
      action: "REST",
      health_flag_to_create: { type: "illness", reason: "Fièvre ou maladie déclarée au checkin" },
      triggered_rule: {
        layer: "A",
        rule_id: "A3",
        detail: "Fièvre ou maladie déclarée — REST",
        signals_used: ["fever_or_illness"],
      },
      reasoning: "Fièvre ou maladie déclarée. Repos complet jusqu'à résolution des symptômes.",
    };
  }

  // A4 — Douleur avec critère objectif de gravité
  if (checkin.pain && (checkin.pain_traumatic || checkin.pain_function_loss || checkin.pain_getting_worse)) {
    const criteria = [
      checkin.pain_traumatic ? "traumatique" : null,
      checkin.pain_function_loss ? "perte de fonction" : null,
      checkin.pain_getting_worse ? "aggravation nette" : null,
    ].filter((c): c is string => c !== null);

    return {
      rule_id: "A4",
      action: "REST",
      health_flag_to_create: {
        type: "injury_suspect",
        reason: `Douleur avec critère objectif de gravité (${criteria.join(", ")})${checkin.pain_location_code ? ` — ${checkin.pain_location_code}` : ""}`,
      },
      triggered_rule: {
        layer: "A",
        rule_id: "A4",
        detail: `Douleur avec critère de gravité objectif (${criteria.join(", ")}) — REST et orientation médicale`,
        signals_used: ["pain_severity_criterion"],
      },
      reasoning:
        "Douleur présentant un critère objectif de gravité. Repos et consultation d'un professionnel de santé recommandée.",
    };
  }

  // A5 — Retour post-commotion sans validation médicale
  const unresolvedConcussion = activeHealthFlags.find(
    (f) => f.type === "concussion_suspect" && f.status !== "resolved",
  );
  if (unresolvedConcussion) {
    return {
      rule_id: "A5",
      action: "ZERO_DH",
      triggered_rule: {
        layer: "A",
        rule_id: "A5",
        detail: "Flag concussion_suspect actif non résolu — DH interdit tant que non validé médicalement",
        signals_used: ["unresolved_concussion_flag"],
      },
      reasoning:
        "Un suivi post-commotion est en cours et n'a pas été validé médicalement. Aucune activité DH tant que la validation n'est pas obtenue ; le reste du plan (hors DH) reste possible.",
    };
  }

  return null;
}
