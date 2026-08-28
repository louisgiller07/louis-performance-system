import type { RawContext } from "../types/rawContext.js";
import type { DailyPlan, ArbitrationDecision, Confidence } from "../types/dailyPlan.js";
import type { AthleteDimensions } from "../types/dimensions.js";
import type { TrainingIntervention, TrainingInterventionKind } from "../types/trainingIntervention.js";
import { sameIntervention } from "../types/trainingIntervention.js";
import type { TriggeredRule } from "../types/triggeredRule.js";
import type { EventContext } from "../types/context.js";

import { computeSystemic, computeLegs, computeArmsGrip, computeMental, computeHealth } from "./computeDimensions.js";
import { computeRecentLoad } from "./recentLoad.js";
import { computeEventContext, hasOverlappingInProgressRaces } from "./eventContext.js";
import { SignalTrace } from "./signalTrace.js";

import { evaluateSafety } from "../rules/safety.js";
import { getModeSoftConstraints, describeStrongConstraintViolation } from "../rules/modes.js";
import { computeRaceProtocolRecommendation } from "../rules/raceProtocol.js";
import { evaluatePainNonSafety } from "../rules/painNonSafety.js";

import { applyTrainingDomainRules } from "../domains/training.js";
import { computeRecoveryDomain } from "../domains/recovery.js";
import { inferFallbackSession } from "../domains/fallbackInference.js";
import { computeTechniqueDomain } from "../domains/technique.js";
import { computeMentalDomain } from "../domains/mental.js";

import { PROVISIONAL_THRESHOLDS } from "./provisionalThresholds.js";

export const ENGINE_VERSION = "head-coach-engine@0.2.0-m1-v0.3_002c";

/**
 * "Même nature" pour l'étiquetage MODIFY vs REPLACE — voir
 * docs/04_DAILY_DECISION_ENGINE.md §5 et docs/10_TEST_PLAN.md T1.3 :
 * AEROBIC_INTERVALS → AEROBIC_BASE est une adaptation d'intensité/structure
 * au sein de la même discipline (aérobie), pas un changement de nature.
 */
const MODIFY_EQUIVALENT_KIND_PAIRS: ReadonlyArray<readonly [TrainingInterventionKind, TrainingInterventionKind]> = [
  ["AEROBIC_INTERVALS", "AEROBIC_BASE"],
];

function isSameNature(a: TrainingInterventionKind, b: TrainingInterventionKind): boolean {
  if (a === b) return true;
  return MODIFY_EQUIVALENT_KIND_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function computeAllDimensions(ctx: RawContext): AthleteDimensions {
  return {
    systemic: computeSystemic(ctx.checkin),
    legs: computeLegs(ctx.checkin),
    arms_grip: computeArmsGrip(ctx.checkin),
    mental: computeMental(ctx.checkin),
    health: computeHealth(ctx.checkin),
    recent_load: computeRecentLoad(ctx.recent_sessions, ctx.today),
  };
}

function buildSafetyPlan(
  ctx: RawContext,
  safety: NonNullable<ReturnType<typeof evaluateSafety>>,
  eventContext: EventContext | undefined,
): DailyPlan {
  const restSession: TrainingIntervention = { kind: "REST" };
  return {
    date: ctx.today,
    active_mode: ctx.active_mode,
    event_context: eventContext,
    training: { active: false, session_type: restSession, objective: "Repos complet — SAFETY" },
    dh_or_technical: { active: false },
    mental: { active: false },
    recovery: { active: true, actions: ["Repos complet", "Suivre les consignes du professionnel de santé"] },
    nutrition: { active: false },
    sleep: { active: true, notes: "Prioriser le sommeil pendant la période de repos" },
    protection: { do_not_do: ["Aucune activité physique tant que non validé médicalement"] },
    monitoring: { observe: ["Évolution des symptômes déclarés"] },
    reasoning: safety.reasoning,
    confidence: "HIGH",
    triggered_rules: [safety.triggered_rule],
    health_flag_to_create: safety.health_flag_to_create,
    planned_session_before: ctx.planned_session,
    final_session: restSession,
    decision: "REST",
    overrode_race_protocol: false,
    engine_version: ENGINE_VERSION,
  };
}

export function buildDailyPlan(ctx: RawContext): DailyPlan {
  const dimensions = computeAllDimensions(ctx);
  const eventContext = computeEventContext(ctx.today, ctx.upcoming_races) ?? undefined;
  const safety = evaluateSafety(ctx.checkin, ctx.active_health_flags);

  if (safety && safety.action === "REST") {
    return buildSafetyPlan(ctx, safety, eventContext);
  }

  const modeConstraints = getModeSoftConstraints(ctx.active_mode);
  const raceProtocol = eventContext ? computeRaceProtocolRecommendation(eventContext, ctx.today) : null;
  const trace = new SignalTrace();
  const triggeredRules: TriggeredRule[] = [];

  if (raceProtocol && eventContext) {
    const rule_id = eventContext.in_progress ? "RACE_DAY_ACTIVE" : eventContext.phase === "POST_EVENT" ? "POST_EVENT" : "RACE_PROTOCOL_TX";
    triggeredRules.push({ layer: "B", rule_id, detail: raceProtocol.reasoning, signals_used: [] });
  }

  // Arbitrage : planned_session + recommandation T-X + dimensions + contexte — voir
  // docs/04_DAILY_DECISION_ENGINE.md §3 et §5. Le protocole T-X participe à
  // l'arbitrage même quand une séance était déjà planifiée : un planned_session
  // générique qui n'a pas anticipé la course ne prime pas automatiquement sur
  // la recommandation T-X (celle-ci reste elle-même overridable par les
  // dimensions/contexte via les règles de domaine ci-dessous — voir T4).
  let baseline: TrainingIntervention;
  if (raceProtocol) {
    baseline = raceProtocol.recommended_session;
  } else if (ctx.planned_session) {
    baseline = ctx.planned_session;
  } else {
    baseline = inferFallbackSession(ctx.today);
    triggeredRules.push({
      layer: "C",
      rule_id: "INFERENCE_FALLBACK",
      detail: `Aucune séance planifiée — inférence depuis le contexte (mode=${ctx.active_mode})`,
      signals_used: [],
    });
  }

  const domainResult = applyTrainingDomainRules(dimensions, baseline, trace);
  triggeredRules.push(...domainResult.triggeredRules);
  let session = domainResult.session;
  const protection: string[] = [...domainResult.doNotDo];
  const monitoring: string[] = [];

  const pain = evaluatePainNonSafety(ctx.checkin, session, trace);
  if (pain) {
    triggeredRules.push(pain.triggered_rule);
    monitoring.push(...pain.monitoring);
    protection.push(...pain.protection);
    if (pain.adapted_session) session = pain.adapted_session;
  }

  if (dimensions.recent_load.level === "RED") {
    monitoring.push("Surveiller la charge cumulée sur 7 jours (très élevée)");
  }

  // Détection de contradiction — incohérence STRUCTURELLE des données, PAS un
  // désaccord entre dimensions valides ni un conflit plan/soft-constraint
  // (voir docs/10_TEST_PLAN.md T10.2 et docs/11_DECISION_LOG.md 2026-08-13 round 2).
  // systemic GREEN + recent_load RED est un état parfaitement plausible (frais
  // aujourd'hui malgré une grosse charge récente) — PAS une contradiction.
  // La seule source de confidence LOW en M1 est un contexte réellement
  // impossible à résoudre de façon déterministe : ici, deux courses marquées
  // "en cours" le même jour (donnée de calendrier structurellement invalide).
  const contradictionDetected = hasOverlappingInProgressRaces(ctx.today, ctx.upcoming_races);
  if (contradictionDetected) {
    triggeredRules.push({
      layer: "ARBITRATION",
      rule_id: "CONTRADICTION_OVERLAPPING_RACES",
      detail:
        "Incohérence structurelle : plusieurs courses sont marquées 'en cours' à la même date — contexte non résolvable de façon fiable sans donnée supplémentaire",
      signals_used: [],
    });
  }

  // Soft constraints `strong` du mode — arbitrables, PAS hard (seule SAFETY
  // l'est). Elles participent réellement à l'arbitrage : si rien ne justifie
  // de garder une séance qui les enfreint, la contrainte s'applique (pivot).
  // Si `planned_intent` documente une raison délibérée, le plan initial est
  // conservé malgré la contrainte. Dans les deux cas, l'issue est tracée —
  // voir docs/11_DECISION_LOG.md 2026-08-13 round 2 (strong ≠ hard, strong ≠
  // ignoré). Toute dérogation réelle (SOFT_CONSTRAINT_STRONG_OVERRIDDEN) est
  // en plus loggée dans `override_reason` (voir calcul plus bas) — le canon
  // exige qu'une dérogation significative à une soft constraint soit loggée
  // avec `override_reason`, pas seulement tracée dans `triggered_rules`.
  for (const constraint of modeConstraints.filter((c) => c.weight === "strong")) {
    const violation = describeStrongConstraintViolation(constraint, session);
    if (!violation) continue;

    if (ctx.planned_intent) {
      triggeredRules.push({
        layer: "ARBITRATION",
        rule_id: "SOFT_CONSTRAINT_STRONG_OVERRIDDEN",
        detail: `Override ${constraint.type} (strong): ${ctx.planned_intent}`,
        signals_used: [],
      });
    } else {
      const previousKind = session.kind;
      session = violation.replacement;
      protection.push(violation.protectionNote);
      triggeredRules.push({
        layer: "ARBITRATION",
        rule_id: "SOFT_CONSTRAINT_STRONG_APPLIED",
        detail: `Contrainte "${constraint.type}" (strong, mode ${ctx.active_mode}) appliquée, aucune justification déclarée (planned_intent absent) : ${previousKind} → ${session.kind}`,
        signals_used: [],
      });
    }
  }

  // A5 (SAFETY, ZERO_DH) — toujours tracée, même si la séance finale n'est pas
  // du DH. Seule une séance DH est effectivement remplacée. SAFETY reste la
  // seule couche réellement hard : elle a le dernier mot après l'arbitrage
  // des soft constraints ci-dessus.
  const DH_KINDS = new Set(["DH_TECHNICAL", "DH_PERFORMANCE", "DH_LIGHT", "PUMPTRACK", "RACE_ACTIVITY"]);
  if (safety && safety.action === "ZERO_DH") {
    triggeredRules.push(safety.triggered_rule);
    protection.push("Aucune activité DH tant que la validation médicale post-commotion n'est pas obtenue");
    if (DH_KINDS.has(session.kind)) {
      session = { kind: "RECOVERY_ACTIVE" };
    }
  }

  // Le "plan réel" pour l'étiquetage KEEP/MODIFY/REPLACE est planned_session
  // s'il existait, sinon la baseline effectivement utilisée (recommandation
  // T-X ou fallback d'inférence).
  const comparisonBase = ctx.planned_session ?? baseline;
  const decision: ArbitrationDecision = sameIntervention(session, comparisonBase)
    ? "KEEP"
    : isSameNature(comparisonBase.kind, session.kind)
      ? "MODIFY"
      : "REPLACE";

  // override_reason couvre deux sources de dérogation, potentiellement
  // combinées dans le même champ (docs/07_GLOSSARY.md §override_reason) :
  //  - un écart avec la recommandation du protocole T-X (overrodeRaceProtocol)
  //  - une dérogation réelle à une soft constraint strong (SOFT_CONSTRAINT_STRONG_OVERRIDDEN)
  const overrodeRaceProtocol = raceProtocol ? !sameIntervention(raceProtocol.recommended_session, session) : false;
  const softConstraintOverrides = triggeredRules.filter((r) => r.rule_id === "SOFT_CONSTRAINT_STRONG_OVERRIDDEN");

  let overrideReason: string | undefined;
  if (overrodeRaceProtocol) {
    // Inclut naturellement SOFT_CONSTRAINT_STRONG_OVERRIDDEN/APPLIED (layer ARBITRATION)
    // si l'écart au protocole T-X en découle.
    const causingRules = triggeredRules.filter((r) => r.layer === "C" || r.layer === "ARBITRATION");
    overrideReason =
      causingRules.length > 0
        ? causingRules.map((r) => r.detail).join(" ")
        : `Séance finale (${session.kind}) différente de la recommandation T-X (${raceProtocol?.recommended_session.kind}), sans cause de domaine tracée.`;
  } else if (softConstraintOverrides.length > 0) {
    overrideReason = softConstraintOverrides.map((r) => r.detail).join(" ");
  }

  const confidence: Confidence =
    safety && safety.action === "ZERO_DH" ? "HIGH" : contradictionDetected ? "LOW" : "MEDIUM";

  const sleepActive = modeConstraints.some((c) => c.type === "protect_sleep") || dimensions.systemic.level === "RED";

  // Calculé ici (après Training, avant la construction du plan) mais son
  // éventuelle triggeredRule n'est poussée qu'APRÈS la construction du
  // littéral ci-dessous — training.objective et override_reason lisent
  // triggeredRules avant cet ajout, jamais après, pour ne jamais confondre
  // une règle Mental avec la dernière règle Training/override réellement
  // pertinente.
  const mentalResult = computeMentalDomain({
    mentalDimension: dimensions.mental,
    eventContext,
    signalTrace: trace,
  });

  const plan: DailyPlan = {
    date: ctx.today,
    active_mode: ctx.active_mode,
    event_context: eventContext,

    training: {
      active: session.kind !== "REST",
      session_type: session,
      duration_min: session.duration_min,
      objective: triggeredRules.length > 0 ? triggeredRules[triggeredRules.length - 1]?.detail : undefined,
    },
    dh_or_technical: computeTechniqueDomain({
      finalSession: session,
      today: ctx.today,
      upcomingRaces: ctx.upcoming_races,
      systemicLevel: dimensions.systemic.level,
      legsLevel: dimensions.legs.level,
      armsGripLevel: dimensions.arms_grip.level,
    }),
    mental: mentalResult.mental,
    recovery: computeRecoveryDomain({ finalSession: session, modeConstraints, eventContext }),
    nutrition: { active: false },
    sleep: sleepActive
      ? {
          active: true,
          target_hours: PROVISIONAL_THRESHOLDS.sleep.targetHoursBaseline,
          notes: "Cible sommeil PROVISIONAL — à individualiser (docs/03_COACHING_MODEL.md C4.1)",
        }
      : { active: false },
    protection: { do_not_do: protection },
    monitoring: { observe: monitoring },

    reasoning:
      triggeredRules.length > 0
        ? triggeredRules.map((r) => r.detail).join(" ")
        : "Aucun signal particulier — séance maintenue telle quelle.",
    confidence,

    triggered_rules: triggeredRules,

    planned_session_before: ctx.planned_session,
    final_session: session,
    decision,

    overrode_race_protocol: overrodeRaceProtocol,
    override_reason: overrideReason,

    engine_version: ENGINE_VERSION,
  };

  // Ajoutée seulement maintenant (même référence de tableau que
  // plan.triggered_rules) : training.objective/reasoning/override_reason
  // ci-dessus ont déjà lu triggeredRules avant cet ajout.
  if (mentalResult.triggeredRule) {
    triggeredRules.push(mentalResult.triggeredRule);
  }

  return plan;
}
