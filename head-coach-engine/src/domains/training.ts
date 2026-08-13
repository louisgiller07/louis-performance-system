import type { AthleteDimensions } from "../types/dimensions.js";
import type { TrainingIntervention } from "../types/trainingIntervention.js";
import { withDowngradedLoad } from "../types/trainingIntervention.js";
import type { TriggeredRule } from "../types/triggeredRule.js";
import type { SignalTrace } from "../engine/signalTrace.js";

export interface TrainingDomainResult {
  session: TrainingIntervention;
  triggeredRules: TriggeredRule[];
  doNotDo: string[];
}

const DH_INTENSE_KINDS = new Set(["DH_TECHNICAL", "DH_PERFORMANCE", "PUMPTRACK"]);

/**
 * Couche C — Domaine Préparation physique (training). Chaque dimension RED
 * est traitée par une cause identifiée, jamais par un score global — voir
 * docs/04_DAILY_DECISION_ENGINE.md §4 et docs/03_COACHING_MODEL.md §Contraintes
 * canoniques #1-2.
 *
 * Ordre d'application : arms_grip, legs, mental, systemic, recent_load.
 * Les scénarios canoniques (docs/10_TEST_PLAN.md T1) isolent une seule
 * dimension RED à la fois ; cet ordre reste défini pour les cas combinés
 * futurs, sans garantie d'exhaustivité au-delà de M1.
 */
export function applyTrainingDomainRules(
  dimensions: AthleteDimensions,
  baseline: TrainingIntervention,
  trace: SignalTrace,
): TrainingDomainResult {
  let session = baseline;
  const triggeredRules: TriggeredRule[] = [];
  const doNotDo: string[] = [];

  // arms_grip RED — C3.5 : pivot vers exercice sans grip.
  if (dimensions.arms_grip.level === "RED" && trace.consume("grip_fatigue_high", "C3.5")) {
    doNotDo.push("Éviter le travail de grip lourd (fatigue avant-bras/grip élevée)");
    const legsRed = dimensions.legs.level === "RED";

    if (session.kind === "GRIP_WORK") {
      session = legsRed
        ? { kind: "RECOVERY_ACTIVE" }
        : { kind: "STRENGTH_LOWER", load_profile: "MODERATE" };
    } else if (DH_INTENSE_KINDS.has(session.kind)) {
      session = { kind: "DH_LIGHT", load_profile: "LIGHT" };
    } else if (session.kind === "STRENGTH_UPPER") {
      session = withDowngradedLoad(session);
    }

    triggeredRules.push({
      layer: "C",
      rule_id: "C3.5",
      detail: "Fatigue grip élevée — pivot vers exercice/séance sans sollicitation grip lourde",
      signals_used: ["grip_fatigue_high"],
    });
  }

  // legs RED — C3.6 : pivot vers haut du corps ou DH léger.
  if (dimensions.legs.level === "RED" && trace.consume("leg_fatigue_high", "C3.6")) {
    doNotDo.push("Éviter le squat lourd / travail jambes intense (fatigue jambes élevée)");
    const gripRed = dimensions.arms_grip.level === "RED";

    if (session.kind === "STRENGTH_LOWER") {
      session = gripRed
        ? { kind: "RECOVERY_ACTIVE" }
        : { kind: "STRENGTH_UPPER", load_profile: "MODERATE" };
    } else if (DH_INTENSE_KINDS.has(session.kind)) {
      session = { kind: "DH_LIGHT", load_profile: "LIGHT" };
    } else if (session.kind === "AEROBIC_BASE" || session.kind === "AEROBIC_INTERVALS") {
      session = withDowngradedLoad(session);
    }

    triggeredRules.push({
      layer: "C",
      rule_id: "C3.6",
      detail: "Fatigue jambes élevée — pivot vers haut du corps / DH léger",
      signals_used: ["leg_fatigue_high"],
    });
  }

  // mental RED — réduit la charge cognitive/structurelle, préserve la séance physique.
  if (dimensions.mental.level === "RED") {
    const signal = dimensions.mental.raw_signals.includes("stress_high") ? "stress_high" : "motivation_low";
    if (trace.consume(signal, "MENTAL_RED")) {
      doNotDo.push("Réduire la charge cognitive de la séance (stress élevé / motivation basse)");

      if (session.kind === "AEROBIC_INTERVALS") {
        session = { kind: "AEROBIC_BASE", load_profile: session.load_profile };
      } else {
        session = withDowngradedLoad(session);
      }

      triggeredRules.push({
        layer: "C",
        rule_id: "MENTAL_RED",
        detail: "Mental RED — réduction de la charge cognitive/structurelle, nature physique préservée",
        signals_used: [signal],
      });
    }
  }

  // systemic RED — C3.3 : réduit l'intensité globale, ne change pas la nature.
  // Consomme tous les signaux causaux réellement présents ce jour-là (voir
  // computeSystemic) — pas seulement `sleep_deficit` — sans jamais réutiliser
  // un signal déjà consommé par une autre règle.
  if (dimensions.systemic.level === "RED") {
    const consumedSignals = dimensions.systemic.raw_signals.filter((s) => trace.consume(s, "C3.3"));
    if (consumedSignals.length > 0) {
      doNotDo.push("Réduire l'intensité globale de la séance (RPE cible réduit) — sommeil insuffisant");

      session = withDowngradedLoad(session);

      triggeredRules.push({
        layer: "C",
        rule_id: "C3.3",
        detail: "Sommeil insuffisant — adaptation d'intensité, nature de la séance préservée",
        signals_used: consumedSignals,
      });
    }
  }

  // recent_load RED — C3.7 : forte recommandation soft, n'impose pas de changement.
  if (dimensions.recent_load.level === "RED" && trace.consume("recent_load_very_high", "C3.7")) {
    triggeredRules.push({
      layer: "C",
      rule_id: "C3.7",
      detail: "Charge 7 jours très élevée — forte recommandation de récupération (soft, arbitrable)",
      signals_used: ["recent_load_very_high"],
    });
  }

  return { session, triggeredRules, doNotDo };
}
