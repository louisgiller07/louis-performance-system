/**
 * UX-11A.5b.5a — the V2 SessionDoseModel injected into the shared planning
 * pipeline (PLAN_DOSE_POLICY_V2, ADR UX-11A.5a.4.1 / 5a.4.2).
 *
 * Week type → plan dose policy → FINAL duration → placement:
 * - Force: policy load and duration (development MODERATE 60, taper LIGHT 45);
 * - DH: the policy duration (90 / 60) and passages (6 / 4) — since v2.2 the
 *   policy is the single authority; the legacy LoadDerivation figure is
 *   never read by V2;
 * - AEROBIC_BASE: the policy duration (45 / 45);
 * - race: no session (template with zero slots).
 *
 * DH_TECHNICAL and AEROBIC_BASE are load-variable kinds: the DB requires a
 * load_profile. V2 keeps LoadDerivation's UNADJUSTED baseline load for them
 * (development MODERATE, taper LIGHT) as structural compatibility metadata
 * (UX-11A.5b.5b); it is not a V2 dose authority and no V2 builder reads it.
 *
 * HistoryAdjuster is never applied: legacy history decrements never touch a
 * V2 dose. Legacy doseTarget fields kept on a session (strength setVolume /
 * targetRpeOrRir, aerobic intensityZone) are LoadDerivation's unadjusted
 * baseline and are never read by the V2 builders.
 */
import { PLAN_DOSE_POLICY_V2, PLAN_DOSE_POLICY_V2_VERSION, type PlanWeekDoseV2 } from "../../catalog/planDosePolicyV2.js";
import type { LoadDerivationOutput } from "../../pipeline/loadDerivation.js";
import type { SessionDoseModel } from "../../pipeline/sessionDoseModel.js";
import type { WeekType } from "../../types/planWeek.js";
import { SessionModelV2ContractError } from "../generationErrors.js";

function weekDose(weekType: WeekType): PlanWeekDoseV2 | null {
  if (weekType === "development") return PLAN_DOSE_POLICY_V2.development;
  if (weekType === "taper") return PLAN_DOSE_POLICY_V2.taper;
  if (weekType === "race") return null;
  throw new SessionModelV2ContractError(`no V2 plan dose for week type "${weekType}" (not produced by the current planner)`);
}

/** LoadDerivation's unadjusted baseline load (compatibility metadata for load-variable kinds). */
function baselineLoad(kind: string, baseline: LoadDerivationOutput): NonNullable<LoadDerivationOutput["loadProfile"]> {
  if (baseline.loadProfile === undefined) throw new SessionModelV2ContractError(`${kind} has no baseline load profile`);
  return baseline.loadProfile;
}

export const PLAN_DOSE_MODEL_V2: SessionDoseModel = {
  modelId: PLAN_DOSE_POLICY_V2_VERSION,

  placementDurationMinByDomain(weekType) {
    const dose = weekDose(weekType);
    if (dose === null) return null;
    return {
      strength: dose.forceDurationMin,
      dh_technical: dose.dhDurationMin,
      aerobic: dose.aerobicBaseDurationMin,
    };
  },

  resolveSessionLoad({ kind, weekType, baseline }): LoadDerivationOutput {
    const dose = weekDose(weekType);
    if (dose === null) throw new SessionModelV2ContractError(`no session expected in a "${weekType}" week (${kind})`);
    switch (kind) {
      case "STRENGTH_LOWER":
      case "STRENGTH_UPPER":
        return { loadProfile: dose.forceLoad, durationMin: dose.forceDurationMin, doseTarget: baseline.doseTarget };
      case "DH_TECHNICAL":
        if (baseline.doseTarget.domain !== "dh_technical") throw new SessionModelV2ContractError(`DH session without a DH dose target`);
        return {
          loadProfile: baselineLoad(kind, baseline),
          durationMin: dose.dhDurationMin,
          doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: dose.dhFocusedPasses },
        };
      case "AEROBIC_BASE":
        return { loadProfile: baselineLoad(kind, baseline), durationMin: dose.aerobicBaseDurationMin, doseTarget: baseline.doseTarget };
      default:
        throw new SessionModelV2ContractError(`session kind ${kind} has no V2 dose (not produced by the current planner)`);
    }
  },
};
