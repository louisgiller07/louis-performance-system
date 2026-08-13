import type { DailyCheckin } from "../types/checkin.js";
import type { TrainingIntervention } from "../types/trainingIntervention.js";
import { isFixedLoadKind, withDowngradedLoad } from "../types/trainingIntervention.js";
import type { TriggeredRule } from "../types/triggeredRule.js";
import type { SignalTrace } from "../engine/signalTrace.js";

/**
 * Douleur non-SAFETY : comportement obligatoire — voir
 * docs/04_DAILY_DECISION_ENGINE.md §2 et docs/03_COACHING_MODEL.md §5.
 * N'est appelé QUE si rules/safety.ts n'a rien déclenché pour ce checkin
 * (la douleur SAFETY est gérée séparément et prioritaire).
 */
export interface PainNonSafetyResult {
  triggered_rule: TriggeredRule;
  monitoring: string[];
  protection: string[];
  adapted_session?: TrainingIntervention;
}

const UPPER_GRIP_SOLICITING_KINDS = new Set([
  "GRIP_WORK",
  "STRENGTH_UPPER",
  "POWER",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
  "RACE_ACTIVITY",
]);

const LOWER_SOLICITING_KINDS = new Set([
  "STRENGTH_LOWER",
  "POWER",
  "DH_TECHNICAL",
  "DH_PERFORMANCE",
  "DH_LIGHT",
  "PUMPTRACK",
  "AEROBIC_BASE",
  "AEROBIC_INTERVALS",
  "RACE_ACTIVITY",
]);

type ZoneCategory = "upper_grip" | "lower" | "other";

function zoneCategory(location: string | undefined): ZoneCategory {
  if (!location) return "other";
  const l = location.toLowerCase();
  if (/(wrist|forearm|hand|thumb|elbow)/.test(l)) return "upper_grip";
  if (/(knee|ankle|hip|quad|hamstring|calf|leg)/.test(l)) return "lower";
  return "other";
}

function sessionSollicitsZone(kind: string, location: string | undefined): boolean {
  const category = zoneCategory(location);
  if (category === "upper_grip") return UPPER_GRIP_SOLICITING_KINDS.has(kind);
  if (category === "lower") return LOWER_SOLICITING_KINDS.has(kind);
  return false;
}

export function evaluatePainNonSafety(
  checkin: DailyCheckin,
  effectiveSession: TrainingIntervention,
  trace: SignalTrace,
): PainNonSafetyResult | null {
  if (!checkin.pain) return null;

  const location = checkin.pain_location_code;
  const signal = `pain_non_safety${location ? `_${location}` : ""}`;
  if (!trace.consume(signal, "PAIN_NON_SAFETY")) return null;

  const zoneLabel = location ?? "zone non précisée";
  const monitoring = [`Surveiller l'évolution de la douleur (${zoneLabel}, intensité ${checkin.pain_intensity}/10) sur 24-48h`];
  const protection = [`Éviter toute charge sollicitant fortement ${zoneLabel}`];

  let adapted_session: TrainingIntervention | undefined;
  const solicited = sessionSollicitsZone(effectiveSession.kind, location);

  if (solicited && !isFixedLoadKind(effectiveSession.kind)) {
    adapted_session = withDowngradedLoad(effectiveSession);
    protection.push(`Réduire l'intensité de la séance pour protéger ${zoneLabel}`);
  }

  const triggered_rule: TriggeredRule = {
    layer: "C",
    rule_id: "PAIN_NON_SAFETY",
    detail: solicited
      ? `Douleur non-SAFETY (${zoneLabel}) — monitoring + protection + adaptation de la séance`
      : `Douleur non-SAFETY (${zoneLabel}) — monitoring + protection, séance non concernée`,
    signals_used: [signal],
  };

  return { triggered_rule, monitoring, protection, adapted_session };
}
