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
/** V0.3_006C1 — exported so buildDailyPlan.ts can pass it into computeTechniqueDomain's terrain precedence without recomputing zone classification a second time. */
export type ZoneCategory = "upper_grip" | "lower" | "other";

export interface PainNonSafetyResult {
  triggered_rule: TriggeredRule;
  monitoring: string[];
  protection: string[];
  adapted_session?: TrainingIntervention;
  /** V0.3_006C1 — always present alongside a real result; "other" when the location is unspecified or not in a mapped category. */
  zone_category: ZoneCategory;
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

function zoneCategory(location: string | undefined): ZoneCategory {
  if (!location) return "other";
  const l = location.toLowerCase();
  // V0.3.013 (PILOT-BLOCK-001) — shoulder_L/shoulder_R (canonical
  // PAIN_LOCATION_CODES, checkinTypes.ts) were never matched by this regex,
  // despite being clearly upper-body/grip-relevant (solicited by the same
  // GRIP_WORK/STRENGTH_UPPER/DH kinds as wrist/forearm/elbow). Unambiguous
  // gap in this category's own existing intent — see docs/11_DECISION_LOG.md
  // V0.3.013. Other unclassified codes (back/neck/groin/chest/abs/head)
  // deliberately left as "other" — no explicit product decision made here.
  if (/(wrist|forearm|hand|thumb|elbow|shoulder)/.test(l)) return "upper_grip";
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
  // V0.3.013 (PILOT-BLOCK-001) — pain reported with NO zone specified
  // (pain_location_code is optional, checkinValidation.ts) previously
  // always resolved to zoneCategory "other" → never solicited → the
  // session was never adapted, while the generic protection message
  // ("Éviter toute charge sollicitant fortement zone non précisée") was
  // still shown next to the full, unmodified prescription — the exact
  // "aggressive prescription + protect message" contradiction this
  // milestone fixes. Absence of a known zone can never rule out that
  // today's session solicits it, so default to a cautious one-notch
  // downgrade (never REST, never a new safety action — same
  // intensity-only adaptation as a classified zone) for any session whose
  // intensity is actually adaptable. A location that IS provided but falls
  // outside the known categories (see zoneCategory) is unchanged — still
  // resolves to "not solicited" (explicit product decision left open, not
  // decided here). See docs/11_DECISION_LOG.md V0.3.013.
  const unspecifiedLocationAdaptable = location === undefined && !isFixedLoadKind(effectiveSession.kind);
  const solicited = sessionSollicitsZone(effectiveSession.kind, location) || unspecifiedLocationAdaptable;

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

  return { triggered_rule, monitoring, protection, adapted_session, zone_category: zoneCategory(location) };
}
