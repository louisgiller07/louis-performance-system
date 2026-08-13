import type { EventContext, RaceFormat, SoftConstraint } from "../types/context.js";
import type { TrainingIntervention } from "../types/trainingIntervention.js";
import { daysBetween } from "../engine/dateUtils.js";

/**
 * RaceProtocolRecommendation — voir docs/07_GLOSSARY.md. N'est jamais une
 * session forcée : le Head Coach (arbitrage) peut la surcharger, avec
 * `override_reason` loggé. Voir docs/04_DAILY_DECISION_ENGINE.md §3.
 */
export interface RaceProtocolRecommendation {
  recommended_session: TrainingIntervention;
  reasoning: string;
  soft_constraints: SoftConstraint[];
}

// T-X — pré-event (days_to_event 1..7). Voir docs/04_DAILY_DECISION_ENGINE.md §3.
const HOT_TRAIL_2DAY_PRE_EVENT: Record<number, TrainingIntervention> = {
  7: { kind: "STRENGTH_UPPER", load_profile: "LIGHT" },
  6: { kind: "DH_TECHNICAL", load_profile: "MODERATE" },
  5: { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 30 },
  4: { kind: "RECOVERY_ACTIVE" },
  3: { kind: "RECOVERY_ACTIVE", duration_min: 20 },
  2: { kind: "REST" },
  1: { kind: "REST" },
};

const IXS_3DAY_PRE_EVENT: Record<number, TrainingIntervention> = {
  ...HOT_TRAIL_2DAY_PRE_EVENT,
  1: { kind: "RACE_ACTIVITY", focus: "Trackwalk / practice officielle" },
};

const PRE_EVENT_TABLES: Partial<Record<RaceFormat, Record<number, TrainingIntervention>>> = {
  HOT_TRAIL_2DAY: HOT_TRAIL_2DAY_PRE_EVENT,
  IXS_3DAY: IXS_3DAY_PRE_EVENT,
};

function priorityWeight(priority: EventContext["race"]["priority"]): SoftConstraint["weight"] {
  return priority === "A_PLUS" ? "strong" : "moderate";
}

/**
 * Calcule la recommandation du protocole T-X pour l'EventContext donné.
 * Retourne `null` si aucune table T-X n'existe pour ce `race_format` (formats
 * autres que HOT_TRAIL_2DAY / IXS_3DAY — hors scope M1, voir docs/12_BACKLOG.md)
 * ou si la phase ne relève pas d'une recommandation (ne devrait pas arriver
 * pour un EventContext déjà jugé pertinent).
 */
export function computeRaceProtocolRecommendation(
  eventContext: EventContext,
  today: string,
): RaceProtocolRecommendation | null {
  const { race, phase } = eventContext;

  if (eventContext.in_progress) {
    return {
      recommended_session: { kind: "RACE_ACTIVITY" },
      reasoning: `Événement en cours (event_day=${eventContext.event_day}, phase=${phase}) — activité de course.`,
      soft_constraints: [],
    };
  }

  if (phase === "POST_EVENT") {
    const daysSinceEventEnd = daysBetween(race.event_end, today);
    return {
      recommended_session: { kind: "RECOVERY_ACTIVE" },
      reasoning: `T+${daysSinceEventEnd} après la fin de ${race.event_name} — récupération active post-course.`,
      soft_constraints: [],
    };
  }

  if (phase === "PRE_EVENT") {
    const table = PRE_EVENT_TABLES[race.race_format];
    const x = eventContext.days_to_event;
    const recommended = table?.[x];
    if (!recommended) return null;

    return {
      recommended_session: recommended,
      reasoning: `T-${x} avant ${race.event_name} (${race.race_format}, priorité ${race.priority}) — protocole T-X par défaut.`,
      soft_constraints: [
        {
          type: "respect_race_protocol",
          reason: `Protocole T-X par défaut pour course priorité ${race.priority}`,
          weight: priorityWeight(race.priority),
        },
      ],
    };
  }

  return null;
}
