/**
 * A07 — the persisted V2 DailyPlan describes the EFFECTIVE session (V2 daily
 * path only, after the reconciliation; M1 itself is unchanged).
 *
 * M1's `final_session` carries M1's own duration (the planned one, or a DH
 * window), while the day's final prescription may define another one (a
 * MODIFY Force LIGHT is a 45-min session, a MODIFY endurance 45 min, a
 * REPLACE Force 45 / 60 min). Every screen reads the decision's final
 * session (Today's header, History, Programme's adaptation): it must say the
 * same thing as the prescription the rider executes.
 *
 * When a final prescription was created with an effective duration that
 * differs from M1's, `final_session.duration_min` and `training` take it, and
 * the change is traced (`V2_EFFECTIVE_SESSION`, layer ARBITRATION, M1's value
 * in the detail) — never in the athlete-facing explanation. Kind and load
 * are already the prescription's (A04 builds the final prescription from
 * them); a different kind is a contract error, never silently aligned.
 */
import type { FinalPrescriptionV2Result } from "./reconcileFinalPrescriptionV2.js";
import type { DailyPlan, TriggeredRule } from "../../types/index.js";

export const V2_EFFECTIVE_SESSION_RULE_ID = "V2_EFFECTIVE_SESSION";

export class EffectiveSessionMismatchError extends Error {
  constructor(message: string) {
    super(`A07 effective session: ${message}`);
    this.name = "EffectiveSessionMismatchError";
  }
}

export function applyV2EffectiveSession(plan: DailyPlan, reconciliation: FinalPrescriptionV2Result): DailyPlan {
  if (reconciliation.status !== "created") return plan;
  const kind = reconciliation.finalPrescription.structure.sessionKind;
  if (kind !== plan.final_session.kind) throw new EffectiveSessionMismatchError(`final prescription ${kind} vs decision ${plan.final_session.kind}`);
  const duration = reconciliation.effectiveDurationMin;
  if (duration === undefined || duration === plan.final_session.duration_min) return plan;

  const rule: TriggeredRule = {
    layer: "ARBITRATION",
    rule_id: V2_EFFECTIVE_SESSION_RULE_ID,
    detail: `Durée de la séance effective : ${duration} min (prescription du jour)${plan.final_session.duration_min !== undefined ? ` — durée M1 : ${plan.final_session.duration_min} min` : ""}.`,
    signals_used: [],
  };
  const finalSession = { ...plan.final_session, duration_min: duration };
  return {
    ...plan,
    final_session: finalSession,
    training: { ...plan.training, session_type: finalSession, duration_min: duration },
    triggered_rules: [...plan.triggered_rules, rule],
  };
}
