/**
 * A10 — the rider's time today (`daily_checkins.available_minutes_today`).
 *
 * Contract: when the rider gave X minutes, no executable final prescription
 * asks for more than X minutes. The day's prescription is first built as
 * usual (A04: KEEP / MODIFY / REPLACE from M1's decision). If it fits, it
 * stays as is. Otherwise the session is adapted with validated content only,
 * the load never going up, in this order:
 *
 *   Force: its LIGHT dose (45 min, the same template — MODIFY, or REPLACE
 *     when the Force was itself a replacement). No shorter Force exists.
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
import type { PrescriptionV2 } from "../prescriptionV2.js";
import { buildFinalPrescriptionV2, type BuildFinalPrescriptionV2Input } from "./buildFinalPrescriptionV2.js";
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
function candidates(structure: PrescriptionV2, decision: Decision, final: FinalSession, plannedKind: string | null, current: number | null, limit: number): { decision: Decision; finalSession: FinalSession }[] {
  const sameKind = plannedKind === final.kind && decision !== "REPLACE";
  const action: Decision = sameKind ? "MODIFY" : "REPLACE";
  const shorter = (d: number) => d <= limit && (current === null || d < current);
  const out: { decision: Decision; finalSession: FinalSession }[] = [];
  switch (structure.family) {
    case "strength":
      if (final.loadProfile !== "LIGHT") out.push({ decision: action, finalSession: { kind: final.kind, loadProfile: "LIGHT" } });
      break;
    case "dh_technical":
      for (const step of PLAN_DH_DURATION_STEPS_V2) {
        if (shorter(step.durationMin)) out.push({ decision: action, finalSession: { ...final, durationMin: step.durationMin } });
      }
      break;
    case "endurance": {
      const { aerobicMinMin, aerobicStepMin } = PLAN_PROGRESSION_CAPS_V2;
      if (current !== null) {
        for (let d = current - aerobicStepMin; d >= aerobicMinMin; d -= aerobicStepMin) {
          if (shorter(d)) out.push({ decision: action, finalSession: { ...final, durationMin: d } });
        }
      }
      break;
    }
  }
  out.push({ decision: "REPLACE", finalSession: { kind: "RECOVERY_ACTIVE" } });
  return out;
}

export function buildFinalPrescriptionWithinTodayTimeV2(input: BuildFinalPrescriptionV2Input & { availableMinutes: number | null }): FinalPrescriptionWithinTodayTimeV2Result {
  const { availableMinutes, ...base } = input;
  const result = buildFinalPrescriptionV2(base);
  if (availableMinutes === null) return result;
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
    const adapted = buildFinalPrescriptionV2({ ...base, decision: { ...base.decision, decision: candidate.decision, finalSession: candidate.finalSession }, timeLimitMin: availableMinutes });
    if (adapted.status === "created" && fits(adapted, availableMinutes)) {
      // The decided duration is the content's own (A07); a recovery range has none.
      return { ...adapted, timeConstraint: outcome("adapted", sessionOf(candidate.decision, { kind: candidate.finalSession.kind, ...(candidate.finalSession.loadProfile !== undefined ? { loadProfile: candidate.finalSession.loadProfile } : {}) }, adapted.effectiveDurationMin)) };
    }
  }
  return { status: "none", reason: "rest", timeConstraint: outcome("rest", { decision: "REST", kind: "REST" }) };
}
