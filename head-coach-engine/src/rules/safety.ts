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
 *
 * Ordre (P0-SAFE, HPM 2026-10-12) : déclarations du jour d'abord (A1 commotion, A2 douleur nouvelle
 * sévère, A3 fièvre, A4 critère de gravité, A6 douleur sévère non nouvelle), puis les signaux des jours
 * précédents encore ouverts (A7 blessure / maladie / douleur persistante → REST, plus conservateur),
 * puis A5 (commotion non résolue → ZERO_DH).
 */
export type SafetyAction = "REST" | "ZERO_DH";

export interface SafetyResult {
  rule_id: "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";
  action: SafetyAction;
  health_flag_to_create?: HealthFlagToCreate;
  triggered_rule: TriggeredRule;
  reasoning: string;
  /** P0-SAFE — rule-specific copy for the REST plan (A6, A7: coaching suspension); absent = the generic Safety copy (A1–A4 unchanged). */
  rest_plan_copy?: { do_not_do: string[]; observe: string[]; recovery_actions: string[] };
}

/**
 * P0-SAFE (HPM 2026-10-12) — A6 reuses A2's 6/10 threshold as a PROVISIONAL conservative trigger (not a
 * validated clinical threshold): a severe pain suspends NALYNT's training proposals whether or not the
 * rider calls it "new" (production incident: 2/10 then 8/10, declared not new, kept as a 90-min DH).
 * Coaching suspension wording, never a medical statement imposing absolute rest (HPM 2026-10-12).
 */
export const SEVERE_PAIN_MIN_INTENSITY = 6;

/** P0-SAFE — open signal types that keep protecting the following days until the rider closes them (A7). */
const FOLLOW_UP_FLAG_TYPES: ReadonlySet<HealthFlag["type"]> = new Set(["injury_suspect", "illness", "pain_persistent"]);

const FOLLOW_UP_FLAG_LABELS: Record<string, string> = {
  injury_suspect: "suspicion de blessure",
  illness: "maladie / fièvre",
  pain_persistent: "douleur persistante",
};

/** "suspicion de blessure du 23.10" — never the raw type slug. */
function describeOpenFlag(flag: HealthFlag): string {
  const label = FOLLOW_UP_FLAG_LABELS[flag.type] ?? "signal de santé";
  if (!flag.flag_date || !/^\d{4}-\d{2}-\d{2}$/.test(flag.flag_date)) return label;
  const [, month, day] = flag.flag_date.split("-");
  return `${label} du ${day}.${month}`;
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

  // A6 — Douleur sévère (≥ 6/10) non déclarée nouvelle et sans critère de gravité (P0-SAFE).
  if (checkin.pain && checkin.pain_intensity >= SEVERE_PAIN_MIN_INTENSITY) {
    return {
      rule_id: "A6",
      action: "REST",
      health_flag_to_create: {
        type: "injury_suspect",
        reason: `Douleur sévère déclarée (${checkin.pain_intensity}/10)${checkin.pain_location_code ? ` — ${checkin.pain_location_code}` : ""}`,
      },
      triggered_rule: {
        layer: "A",
        rule_id: "A6",
        detail: `Douleur forte déclarée (${checkin.pain_intensity}/10) — propositions d'entraînement suspendues, avis d'un professionnel de santé recommandé`,
        signals_used: ["pain_severe"],
      },
      reasoning:
        "Douleur forte déclarée. Par prudence, NALYNT suspend ses propositions d'entraînement. L'avis d'un professionnel de santé est recommandé avant de reprendre l'entraînement.",
      rest_plan_copy: {
        do_not_do: ["Pas d'entraînement proposé par NALYNT tant que la douleur n'a pas été réévaluée"],
        observe: ["Évolution de la douleur déclarée"],
        recovery_actions: ["Propositions d'entraînement suspendues", "Avis d'un professionnel de santé recommandé"],
      },
    };
  }

  // A7 — Signal de santé précédent non clôturé (P0-SAFE) : une réponse rassurante d'un jour
  // ne l'efface pas ; seule une clôture explicite par le rider (persistée) le lève.
  // Deterministic order (declaration date, then type): the reminder never depends on the database row order.
  const openFollowUps = activeHealthFlags
    .filter((f) => FOLLOW_UP_FLAG_TYPES.has(f.type) && f.status !== "resolved")
    .sort((x, y) => (x.flag_date ?? "").localeCompare(y.flag_date ?? "") || x.type.localeCompare(y.type));
  if (openFollowUps.length > 0) {
    const described = openFollowUps.map(describeOpenFlag).join(", ");
    return {
      rule_id: "A7",
      action: "REST",
      triggered_rule: {
        layer: "A",
        rule_id: "A7",
        detail: `Signal de santé ouvert (${described}) — propositions d'entraînement suspendues jusqu'à sa clôture`,
        signals_used: ["unresolved_health_flag"],
      },
      reasoning: `Un signal de santé déclaré précédemment (${described}) est toujours ouvert. Par prudence, NALYNT suspend ses propositions d'entraînement tant qu'il n'est pas clôturé. Tu peux le clôturer dans l'application quand ses conditions de clôture sont réunies ; en cas de doute, consulte un professionnel de santé.`,
      rest_plan_copy: {
        do_not_do: ["Pas d'entraînement proposé par NALYNT tant que le signal de santé est ouvert"],
        observe: ["Évolution de la douleur ou des symptômes déclarés précédemment"],
        recovery_actions: ["Propositions d'entraînement suspendues", "Clôturer le signal dans l'application quand ses conditions sont réunies"],
      },
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
