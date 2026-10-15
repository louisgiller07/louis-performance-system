/**
 * A10 — the rider's time today (`daily_checkins.available_minutes_today`).
 *
 * Contract: when the rider gave X minutes, no executable final prescription
 * asks for more than X minutes. The day's prescription is first built as
 * usual (A04: KEEP / MODIFY / REPLACE from M1's decision). If it fits, it
 * stays as is. Otherwise the session is adapted with validated content only,
 * the load never going up, in this order:
 *
 *   Force (PHYS-01.1): the same session at the SAME dose (never a dose
 *     change for time), its cool-down reduced to its mobility, then its last
 *     work exercises left out one by one (3 → 2 → 1, the principal always
 *     kept); never a shorter rest, never a warm-up item removed. A Force
 *     session's duration here is its content's estimate
 *     (estimateStrengthDurationMinutesV2), never the planner's slot — also
 *     for the session decided before the constraint.
 *   DH: the planner's availability windows (90 / 75 / 60 min, passages
 *     capped by the window), same drill. Nothing under 60 min.
 *   Endurance: the same protocol, 15 min shorter per step (the planner's
 *     availability step), never under the protocol's 45 min.
 *   then active recovery (REPLACE), its protocol ranges narrowed to fit,
 *     when at least its minimum (20 min) fits;
 *   then REST: no session is invented.
 *
 * Every candidate is built by the real builders and checked against X; the
 * first one that fits is the day's prescription. The outcome says what the
 * session was before, what it is after, and the action, so the Head Coach
 * can rewrite and trace its decision (V2_TODAY_TIME_CONSTRAINT).
 */
import type { LoadProfile } from "../../types/sharedVocabulary.js";
import { PLAN_DH_DURATION_STEPS_V2, PLAN_PROGRESSION_CAPS_V2 } from "../../catalog/planDosePolicyV2.js";
import { POWER_SESSION_POLICY_V2 } from "../../catalog/powerSessionPolicyV2.js";
import type { PrescriptionV2 } from "../prescriptionV2.js";
import { buildFinalPrescriptionV2, type BuildFinalPrescriptionV2Input } from "./buildFinalPrescriptionV2.js";
import { estimateStrengthDurationMinutesV2 } from "../strengthDurationV2.js";
import type { FinalPrescriptionV2Result } from "./finalPrescriptionV2.js";

type Decision = BuildFinalPrescriptionV2Input["decision"]["decision"];
type FinalSession = BuildFinalPrescriptionV2Input["decision"]["finalSession"];

export interface TodayTimeSessionV2 {
  decision: Decision;
  kind: string;
  loadProfile?: LoadProfile;
  durationMin?: number;
}

export interface TodayTimeConstraintV2 {
  availableMinutes: number;
  /**
   * fits: the session already fits; adapted: another session, built and
   * checked; rest: nothing valid fits; not_evaluated: no executable
   * prescription to check (blocked).
   */
  action: "fits" | "adapted" | "rest" | "not_evaluated";
  /** The session decided before the constraint (its effective duration when known). */
  before: TodayTimeSessionV2;
  /** The session after the constraint (= before unless adapted / rest). */
  after: TodayTimeSessionV2;
}

export type FinalPrescriptionWithinTodayTimeV2Result = FinalPrescriptionV2Result & { timeConstraint?: TodayTimeConstraintV2 };

/** The longest a prescription may ask for: its effective duration, else the sum of its blocks' upper bounds. */
export function prescriptionMaxMinutes(result: Extract<FinalPrescriptionV2Result, { status: "created" }>): number | null {
  if (result.effectiveDurationMin !== undefined) return result.effectiveDurationMin;
  const blocks = result.finalPrescription.structure.blocks;
  if (blocks.length === 0 || blocks.some((b) => b.durationMinutes === undefined)) return null;
  return blocks.reduce((sum, b) => sum + b.durationMinutes!.max, 0);
}

/** PHYS-01.1 — under the rider's time, a Force prescription's duration is its content's estimate. */
function withStrengthEstimate<R extends FinalPrescriptionV2Result>(result: R): R {
  if (result.status !== "created" || result.finalPrescription.structure.family !== "strength") return result;
  return { ...result, effectiveDurationMin: estimateStrengthDurationMinutesV2(result.finalPrescription.structure) };
}

function fits(result: FinalPrescriptionV2Result, limit: number): boolean {
  if (result.status !== "created") return false;
  const max = prescriptionMaxMinutes(result);
  return max !== null && max <= limit;
}

function sessionOf(decision: Decision, final: FinalSession, durationMin: number | undefined): TodayTimeSessionV2 {
  return {
    decision,
    kind: final.kind,
    ...(final.loadProfile !== undefined ? { loadProfile: final.loadProfile } : {}),
    ...(durationMin !== undefined ? { durationMin } : {}),
  };
}

/** The adapted sessions to try, in order (each lower or equal in load, shorter). */
type Candidate = { decision: Decision; finalSession: FinalSession; strengthWorkSlots?: number };

function candidates(structure: PrescriptionV2, decision: Decision, final: FinalSession, plannedKind: string | null, current: number | null, limit: number): Candidate[] {
  const sameKind = plannedKind === final.kind && decision !== "REPLACE";
  const action: Decision = sameKind ? "MODIFY" : "REPLACE";
  const shorter = (d: number) => d <= limit && (current === null || d < current);
  const out: Candidate[] = [];
  switch (structure.family) {
    case "strength": {
      // PHYS-01.1 — same session, same dose (M1's): cool-down reduced, then the last work exercises left out.
      const work = structure.blocks.filter((b) => b.role === "main" || b.role === "complementary").length;
      for (let n = work; n >= 1; n -= 1) out.push({ decision: action, finalSession: { kind: final.kind, ...(final.loadProfile !== undefined ? { loadProfile: final.loadProfile } : {}) }, strengthWorkSlots: n });
      break;
    }
    case "power": {
      // PHYS-03 — same session, same dose (M1's): the last explosive exercises left out, never below three.
      const work = structure.blocks.filter((b) => b.role === "main").length;
      for (let n = work - 1; n >= POWER_SESSION_POLICY_V2.explosiveExercises.min; n -= 1) out.push({ decision: action, finalSession: { kind: final.kind, ...(final.loadProfile !== undefined ? { loadProfile: final.loadProfile } : {}) }, strengthWorkSlots: n });
      break;
    }
    case "dh_technical":
      for (const step of PLAN_DH_DURATION_STEPS_V2) {
        if (shorter(step.durationMin)) out.push({ decision: action, finalSession: { ...final, durationMin: step.durationMin } });
      }
      break;
    case "endurance": {
      const { aerobicMinMin, aerobicStepMin } = PLAN_PROGRESSION_CAPS_V2;
      if (current === null) break;
      const steps: number[] = [];
      for (let d = current - aerobicStepMin; d >= aerobicMinMin; d -= aerobicStepMin) steps.push(d);
      // PHYS-02 — a duration off the 15-min grid (a base session from a 53-min intervals one) still reaches the minimum.
      if (current > aerobicMinMin && !steps.includes(aerobicMinMin)) steps.push(aerobicMinMin);
      if (structure.sessionKind === "AEROBIC_INTERVALS") {
        // PHYS-02 — intervals are never shortened (one dose): the base endurance session that fits, then recovery.
        for (const d of steps) {
          if (shorter(d)) out.push({ decision: "REPLACE", finalSession: { kind: "AEROBIC_BASE", ...(final.loadProfile !== undefined ? { loadProfile: final.loadProfile } : {}), durationMin: d } });
        }
        break;
      }
      for (const d of steps) {
        if (shorter(d)) out.push({ decision: action, finalSession: { ...final, durationMin: d } });
      }
      break;
    }
  }
  out.push({ decision: "REPLACE", finalSession: { kind: "RECOVERY_ACTIVE" } });
  return out;
}

export function buildFinalPrescriptionWithinTodayTimeV2(input: BuildFinalPrescriptionV2Input & { availableMinutes: number | null }): FinalPrescriptionWithinTodayTimeV2Result {
  const { availableMinutes, ...base } = input;
  if (availableMinutes === null) return buildFinalPrescriptionV2(base);
  const result = withStrengthEstimate(buildFinalPrescriptionV2(base));
  if (!Number.isInteger(availableMinutes) || availableMinutes <= 0) throw new RangeError(`availableMinutes must be a positive integer, got ${availableMinutes}`);

  const { decision: decisionValue, finalSession } = base.decision;
  const current = result.status === "created" ? prescriptionMaxMinutes(result) : null;
  const before = sessionOf(decisionValue, finalSession, current ?? finalSession.durationMin);
  const outcome = (action: TodayTimeConstraintV2["action"], after: TodayTimeSessionV2): TodayTimeConstraintV2 => ({ availableMinutes, action, before, after });

  if (result.status === "none") return { ...result, timeConstraint: outcome("fits", before) };
  if (result.status === "blocked") return { ...result, timeConstraint: outcome("not_evaluated", before) };
  if (fits(result, availableMinutes)) return { ...result, timeConstraint: outcome("fits", before) };

  const plannedKind = base.lineage?.generatedSession?.kind ?? null;
  for (const candidate of candidates(result.finalPrescription.structure, decisionValue, finalSession, plannedKind, current, availableMinutes)) {
    const adapted = withStrengthEstimate(
      buildFinalPrescriptionV2({
        ...base,
        decision: { ...base.decision, decision: candidate.decision, finalSession: candidate.finalSession },
        timeLimitMin: availableMinutes,
        ...(candidate.strengthWorkSlots !== undefined ? { strengthWorkSlots: candidate.strengthWorkSlots } : {}),
      })
    );
    if (adapted.status === "created" && fits(adapted, availableMinutes)) {
      // The decided duration is the content's own (A07); a recovery range has none.
      return { ...adapted, timeConstraint: outcome("adapted", sessionOf(candidate.decision, { kind: candidate.finalSession.kind, ...(candidate.finalSession.loadProfile !== undefined ? { loadProfile: candidate.finalSession.loadProfile } : {}) }, adapted.effectiveDurationMin)) };
    }
  }
  return { status: "none", reason: "rest", timeConstraint: outcome("rest", { decision: "REST", kind: "REST" }) };
}
