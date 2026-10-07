/**
 * A10 — the rider's time today (V2 daily path only, after the reconciliation;
 * M1 itself is unchanged).
 *
 * The reconciliation (buildFinalPrescriptionWithinTodayTimeV2) already built
 * a prescription that fits in the minutes the rider gave, with validated
 * content only. This step makes the DECISION say the same thing: when the
 * session had to change, the decision, its final session and `training`
 * take the adapted session (MODIFY / REPLACE / REST), so every screen (A07)
 * reads one effective session.
 *
 * Trace: rule `V2_TODAY_TIME_CONSTRAINT` (layer ARBITRATION) in
 * `triggered_rules` whenever a time was given (minutes, session before,
 * action, session after). When the session changed, it is also in
 * `decision_reasoning` with a plain athlete-facing sentence, appended to
 * M1's own reasons, and `training.objective` carries that sentence. The
 * session-derived sections follow the new session (realignSessionSections:
 * no DH technique, nutrition, recovery or monitoring advice on a recovery).
 * No time given → the plan is returned as is.
 */
import { joinDecisionReasoning } from "../../engine/reasoningBuilder.js";
import type { DailyPlan, TrainingIntervention, TriggeredRule } from "../../types/index.js";
import type { FinalPrescriptionV2Result, TodayTimeConstraintV2 } from "./reconcileFinalPrescriptionV2.js";
import { realignSessionSections } from "./realignSessionSections.js";

export const V2_TODAY_TIME_CONSTRAINT_RULE_ID = "V2_TODAY_TIME_CONSTRAINT";

const LOAD_RANK: Readonly<Record<string, number>> = { LIGHT: 0, MODERATE: 1, HEAVY: 2 };

type Session = TodayTimeConstraintV2["before"];

function describe(s: Session): string {
  return [s.decision, s.kind, s.loadProfile, s.durationMin !== undefined ? `${s.durationMin} min` : null].filter((x) => x).join(" ");
}

/** The athlete-facing sentence: what happened, in plain words. */
function athleteSentence(c: TodayTimeConstraintV2): string {
  const head = `Tu as ${c.availableMinutes} min aujourd'hui :`;
  if (c.action === "rest") return `${head} aucune séance ne tient honnêtement dans ce temps, repos aujourd'hui.`;
  if (c.after.kind === "RECOVERY_ACTIVE" && c.before.kind !== "RECOVERY_ACTIVE") return `${head} la séance prévue ne tient pas dans ce temps, récupération active à la place.`;
  const lighter = c.after.loadProfile !== undefined && c.before.loadProfile !== undefined && LOAD_RANK[c.after.loadProfile]! < LOAD_RANK[c.before.loadProfile]!;
  return `${head} la séance a été ${lighter ? "allégée" : "raccourcie"} pour tenir dans ce temps.`;
}

export function applyV2TodayTimeConstraint(plan: DailyPlan, reconciliation: FinalPrescriptionV2Result): DailyPlan {
  const c = reconciliation.timeConstraint;
  if (c === undefined) return plan;

  const changed = c.action === "adapted" || c.action === "rest";
  const trace: TriggeredRule = {
    layer: "ARBITRATION",
    rule_id: V2_TODAY_TIME_CONSTRAINT_RULE_ID,
    detail: `Temps disponible : ${c.availableMinutes} min. Avant : ${describe(c.before)}. Action : ${c.action}${changed ? ` → ${describe(c.after)}` : ""}.`,
    signals_used: ["available_minutes_today"],
  };
  if (!changed) return { ...plan, triggered_rules: [...plan.triggered_rules, trace] };

  const sentence = athleteSentence(c);
  const finalSession = {
    kind: c.after.kind,
    ...(c.after.loadProfile !== undefined ? { load_profile: c.after.loadProfile } : {}),
    ...(c.after.durationMin !== undefined ? { duration_min: c.after.durationMin } : {}),
  } as TrainingIntervention;
  const decisionReasoning = [...(plan.decision_reasoning ?? []), { ...trace, detail: sentence }];
  const { duration_min: _duration, ...training } = plan.training;
  return {
    ...plan,
    decision: c.after.decision,
    final_session: finalSession,
    training: {
      ...training,
      active: finalSession.kind !== "REST",
      session_type: finalSession,
      ...(finalSession.duration_min !== undefined ? { duration_min: finalSession.duration_min } : {}),
      objective: sentence,
    },
    // P0 coherence — the session-derived sections follow the effective session (no DH advice on a recovery).
    ...realignSessionSections(plan, finalSession),
    reasoning: joinDecisionReasoning(decisionReasoning),
    triggered_rules: [...plan.triggered_rules, trace],
    decision_reasoning: decisionReasoning,
  };
}
