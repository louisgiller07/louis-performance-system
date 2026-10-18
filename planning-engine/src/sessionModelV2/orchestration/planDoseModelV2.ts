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
 * Load profiles (policy v2.3): the final load of every generated kind —
 * Force, DH_TECHNICAL, AEROBIC_BASE — comes from the policy only; the
 * LoadDerivation baseline load is never the final V2 load.
 *
 * HistoryAdjuster is never applied: legacy history decrements never touch a
 * V2 dose. Legacy doseTarget fields kept on a session (strength setVolume /
 * targetRpeOrRir, aerobic intensityZone) are LoadDerivation's unadjusted
 * baseline and are never read by the V2 builders.
 *
 * BUG-V2-2 (policy v2.4): the model shapes the whole block
 * (blockProgressionV2.ts) — each week gets a role (introduction, build,
 * build+, consolidation, race-specific, taper, race) and that role's dose,
 * fitted to the real availability. Every placed session's load and duration
 * then come from its week's shape. placementDurationMinByDomain(weekType) is
 * kept for callers without shapes (development = build cycle 0).
 *
 * PHYS-02: `planDoseModelV2({ enduranceIntervals: true })` also places the
 * intervals session in the weeks its policy names (blockProgressionV2) and
 * gives that week's aerobic slot the AEROBIC_INTERVALS kind, at the
 * protocol's duration. PLAN_DOSE_MODEL_V2 (no option) is unchanged.
 */
import { PLAN_DOSE_POLICY_V2, PLAN_DOSE_POLICY_V2_VERSION, type PlanWeekDoseV2 } from "../../catalog/planDosePolicyV2.js";
import type { LoadDerivationOutput } from "../../pipeline/loadDerivation.js";
import type { SessionDoseModel, WeekShape } from "../../pipeline/sessionDoseModel.js";
import type { SessionDomain } from "../../pipeline/weekSegmenter.js";
import type { SessionKind } from "../../types/sharedVocabulary.js";
import type { WeekType } from "../../types/planWeek.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import { shapeBlockWeeksV2, shapedLoadV2, type BlockProgressionOptionsV2 } from "./blockProgressionV2.js";

function weekDose(weekType: WeekType): PlanWeekDoseV2 | null {
  if (weekType === "development") return PLAN_DOSE_POLICY_V2.development;
  if (weekType === "taper") return PLAN_DOSE_POLICY_V2.taper;
  if (weekType === "race") return null;
  throw new SessionModelV2ContractError(`no V2 plan dose for week type "${weekType}" (not produced by the current planner)`);
}

export function planDoseModelV2(options: BlockProgressionOptionsV2 = {}): SessionDoseModel {
  const model: SessionDoseModel = { ...PLAN_DOSE_MODEL_V2, shapeWeeks: (input) => shapeBlockWeeksV2(input, options) };
  if (options.enduranceIntervals !== true) return model;
  return {
    ...model,
    // The week's aerobic slot is the intervals session only when its shape placed one.
    refineSessionKind: ({ kind, domain, shape }) =>
      domain === "aerobic" && kind === "AEROBIC_BASE" && shape?.progression.targets.aerobicSessionKind === "AEROBIC_INTERVALS" ? "AEROBIC_INTERVALS" : kind,
  };
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

  shapeWeeks: shapeBlockWeeksV2,

  resolveSessionLoad({ kind, domain, weekType, baseline, shape }): LoadDerivationOutput {
    if (shape !== undefined) return resolveShapedSessionLoad(kind, domain, baseline, shape);
    const dose = weekDose(weekType);
    if (dose === null) throw new SessionModelV2ContractError(`no session expected in a "${weekType}" week (${kind})`);
    switch (kind) {
      case "STRENGTH_LOWER":
      case "STRENGTH_UPPER":
        return { loadProfile: dose.forceLoad, durationMin: dose.forceDurationMin, doseTarget: baseline.doseTarget };
      case "DH_TECHNICAL":
        if (baseline.doseTarget.domain !== "dh_technical") throw new SessionModelV2ContractError(`DH session without a DH dose target`);
        return {
          loadProfile: dose.dhLoad,
          durationMin: dose.dhDurationMin,
          doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: dose.dhFocusedPasses },
        };
      case "AEROBIC_BASE":
        return { loadProfile: dose.aerobicLoad, durationMin: dose.aerobicBaseDurationMin, doseTarget: baseline.doseTarget };
      default:
        throw new SessionModelV2ContractError(`session kind ${kind} has no V2 dose (not produced by the current planner)`);
    }
  },
};

/** BUG-V2-2 — a session of a shaped week: the shape's duration, load and DH passes. */
function resolveShapedSessionLoad(kind: SessionKind, domain: SessionDomain, baseline: LoadDerivationOutput, shape: WeekShape): LoadDerivationOutput {
  const durations = shape.placementDurationMinByDomain;
  if (durations === null) throw new SessionModelV2ContractError(`no session expected in a "${shape.progression.role}" week (${kind})`);
  const loadProfile = shapedLoadV2(shape, domain);
  switch (kind) {
    case "STRENGTH_LOWER":
    case "STRENGTH_UPPER":
    case "AEROBIC_BASE":
      return { loadProfile, durationMin: durations[domain], doseTarget: baseline.doseTarget };
    case "AEROBIC_INTERVALS":
      // PHYS-02 — only in a week whose shape placed the intervals session (its placement duration is the protocol's).
      if (shape.progression.targets.aerobicSessionKind !== "AEROBIC_INTERVALS") throw new SessionModelV2ContractError(`AEROBIC_INTERVALS in a week without an intervals target`);
      return { loadProfile, durationMin: durations.aerobic, doseTarget: baseline.doseTarget };
    case "DH_TECHNICAL": {
      const passes = shape.progression.targets.dhPasses;
      if (passes === null) throw new SessionModelV2ContractError(`DH session in a week without a DH target`);
      return { loadProfile, durationMin: durations.dh_technical, doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: passes } };
    }
    default:
      throw new SessionModelV2ContractError(`session kind ${kind} has no V2 dose (not produced by the current planner)`);
  }
}
