/**
 * HistoryAdjuster (V0.4_110) — pure function adjusting LoadDerivation's
 * baseline downward (never upward) when recentHistory shows a pattern of
 * missed/replaced sessions. The ONLY module in this pipeline that reads
 * recentHistory — never equipment, races, weekType, template, or
 * strengthExperienceTier, all already consumed upstream by earlier stages.
 * Never modifies kind (not even part of this module's output shape), never
 * creates or removes a session, never changes doseTarget.domain.
 *
 * V1 signal: recentMissedOrReplacedCount only. PlanInputRecentHistory
 * carries a single, un-segmented counter — no per-domain breakdown exists
 * in the type — so no domain-specific interpretation is invented here.
 * trailingVolumeMinutes and recentSessionKinds are deliberately not
 * consulted (see V0.4_110 design's own open-question note).
 */
import type { LoadProfile } from "../types/sharedVocabulary.js";
import type { PlanInputRecentHistory } from "../types/planInputSnapshot.js";
import type { LoadDerivationOutput } from "./loadDerivation.js";

export interface HistoryAdjusterInput {
  baseline: LoadDerivationOutput;
  kind: import("../types/sharedVocabulary.js").SessionKind;
  recentHistory: PlanInputRecentHistory;
}

export type HistoryAdjusterOutput = LoadDerivationOutput & {
  adjusted: boolean;
  adjustmentReason?: string;
};

export class InvalidAdjustmentError extends Error {
  constructor(reason: string) {
    super(`HistoryAdjuster: adjustment would produce a structurally invalid value (${reason})`);
    this.name = "InvalidAdjustmentError";
  }
}

const MISSED_OR_REPLACED_THRESHOLD = 3;
const ADJUSTMENT_REASON = "Adjusted due to recent missed or replaced sessions pattern";

// V1 placeholder decrements only — flat, fixed, never a formula. Chosen to
// never reach <= 0 against LoadDerivation's own current baseline figures;
// the guard below is defensive, not expected to fire against real output
// today (same discipline as TemplateNotFoundError/UnsupportedSessionKindError).
const DURATION_DECREMENT_MIN = 10;
const SET_VOLUME_DECREMENT = 2;
const RPE_DECREMENT = 1;
const FOCUSED_RUNS_DECREMENT = 1;

const LOAD_PROFILE_STEP_DOWN: Record<LoadProfile, LoadProfile> = { HEAVY: "MODERATE", MODERATE: "LIGHT", LIGHT: "LIGHT" };

function reducePositive(value: number, decrement: number, fieldName: string): number {
  const reduced = value - decrement;
  if (reduced <= 0) throw new InvalidAdjustmentError(`${fieldName} would become ${reduced}`);
  return reduced;
}

export function adjustHistory(input: HistoryAdjusterInput): HistoryAdjusterOutput {
  if (input.recentHistory.recentMissedOrReplacedCount < MISSED_OR_REPLACED_THRESHOLD) {
    return { ...input.baseline, adjusted: false };
  }

  const { baseline } = input;
  const durationMin = reducePositive(baseline.durationMin, DURATION_DECREMENT_MIN, "durationMin");
  const loadProfile: LoadProfile | undefined = baseline.loadProfile !== undefined ? LOAD_PROFILE_STEP_DOWN[baseline.loadProfile] : undefined;

  let doseTarget = baseline.doseTarget;
  switch (baseline.doseTarget.domain) {
    case "strength":
      doseTarget = {
        domain: "strength",
        setVolume: reducePositive(baseline.doseTarget.setVolume, SET_VOLUME_DECREMENT, "doseTarget.setVolume"),
        targetRpeOrRir: reducePositive(baseline.doseTarget.targetRpeOrRir, RPE_DECREMENT, "doseTarget.targetRpeOrRir"),
      };
      break;
    case "dh_technical":
      doseTarget = {
        domain: "dh_technical",
        skillTargets: baseline.doseTarget.skillTargets,
        focusedRunsCount: reducePositive(baseline.doseTarget.focusedRunsCount, FOCUSED_RUNS_DECREMENT, "doseTarget.focusedRunsCount"),
      };
      break;
    case "aerobic":
      // "easy" is already the floor of this 2-value zone — forcing it here
      // is always a reduction-or-no-op, never an increase, no decrement math needed.
      doseTarget = { domain: "aerobic", intensityZone: "easy" };
      break;
    case "recovery":
      doseTarget = baseline.doseTarget; // nothing to reduce — domain-less, never produced by LoadDerivation today, kept for exhaustiveness.
      break;
  }

  return {
    ...(loadProfile !== undefined ? { loadProfile } : {}),
    durationMin,
    doseTarget,
    adjusted: true,
    adjustmentReason: ADJUSTMENT_REASON,
  };
}
