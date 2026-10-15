/**
 * UX-11A.5a.4 — V2 Plan Dose Policy: the V2 dose of each session domain per
 * planner week type.
 *
 * - development: Force MODERATE 60 min, DH MODERATE 90 min / 6 passages,
 *   endurance base MODERATE 45 min;
 * - taper: Force LIGHT 45 min, DH LIGHT 60 min / 4 passages, endurance base
 *   LIGHT 45 min;
 * - race: the current planner places no normal session (template with zero
 *   slots), so the policy defines none.
 *
 * This policy deliberately does NOT reuse the legacy HistoryAdjuster
 * decrements (−10 min, −1 passage, −2 sets, −1 RPE, LIGHT step-down) nor the
 * legacy taper durations: it can never produce 20 / 30 / 35 min or 3 / 5
 * passages. historyAdjuster.ts itself is unchanged and keeps driving V1.
 *
 * v2.1 (UX-11A.5a.4.2): explicit Force session durations, known before
 * placement (invariant: for a V2 plan every value shaping a session's real
 * duration is known before that session is placed).
 * v2.2 (UX-11A.5a.4.3): the DH session duration is a policy value too — a V2
 * plan no longer depends on the legacy LoadDerivation DH figure.
 * v2.3 (V2 load authority lock): the load profile of EVERY generated kind
 * (Force, DH, endurance base) is a policy value; LoadDerivation's baseline
 * load is never the final V2 load.
 *
 * v2.4 (BUG-V2-2, real 6-week progression): a V2 block is no longer a
 * series of identical development weeks. Each week gets a ROLE
 * (introduction, build, build+, consolidation, race-specific, taper, race)
 * and the role's dose — PLAN_ROLE_DOSES_V2 below, with a per-cycle step on
 * DH passes and endurance minutes, capped by PLAN_PROGRESSION_CAPS_V2. One
 * lever per domain and per step (Force: sets/RPE via the dose step; DH:
 * passes; endurance: duration). `development` / `taper` above are kept
 * (development = build, cycle 0).
 *
 * Every value: PROVISIONAL — coaching validation required.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { StrengthDoseStepV2, StrengthLoadLevelV2 } from "./strengthDoseCatalogV2.js";
import type { WeekProgressionRole } from "../types/planWeek.js";

/** Session load levels a V2 policy may assign (HEAVY out of scope). */
export type PlanLoadV2 = "LIGHT" | "MODERATE";

export const PLAN_DOSE_POLICY_V2_VERSION = "plan-dose-policy-v2.4";

export interface PlanWeekDoseV2 {
  forceLoad: StrengthLoadLevelV2;
  forceDurationMin: number;
  dhLoad: PlanLoadV2;
  dhDurationMin: number;
  dhFocusedPasses: number;
  aerobicLoad: PlanLoadV2;
  aerobicBaseDurationMin: number;
}

export interface PlanDosePolicyV2 {
  development: PlanWeekDoseV2;
  taper: PlanWeekDoseV2;
  /** No normal session is planned in a race week by the current planner. */
  race: null;
  validationStatus: ContentValidationStatus;
}

export const PLAN_DOSE_POLICY_V2: PlanDosePolicyV2 = {
  development: { forceLoad: "MODERATE", forceDurationMin: 60, dhLoad: "MODERATE", dhDurationMin: 90, dhFocusedPasses: 6, aerobicLoad: "MODERATE", aerobicBaseDurationMin: 45 },
  taper: { forceLoad: "LIGHT", forceDurationMin: 45, dhLoad: "LIGHT", dhDurationMin: 60, dhFocusedPasses: 4, aerobicLoad: "LIGHT", aerobicBaseDurationMin: 45 },
  race: null,
  validationStatus: "PROVISIONAL",
};

/** BUG-V2-2 — the dose of a week role at cycle 0, and its step per completed build cycle. */
export interface PlanRoleDoseV2 extends PlanWeekDoseV2 {
  forceDoseStep: StrengthDoseStepV2;
  dhPassesPerCycle: number;
  aerobicMinPerCycle: number;
}

/** Roles that carry sessions (a race week places none). */
export type PlanDosedRoleV2 = Exclude<WeekProgressionRole, "race">;

export const PLAN_ROLE_DOSES_V2: Readonly<Record<PlanDosedRoleV2, PlanRoleDoseV2>> = {
  // Baseline: lighter everywhere, technique first (fewer, quality passes).
  introduction: { forceLoad: "LIGHT", forceDoseStep: "LIGHT", forceDurationMin: 45, dhLoad: "LIGHT", dhDurationMin: 75, dhFocusedPasses: 5, aerobicLoad: "LIGHT", aerobicBaseDurationMin: 45, dhPassesPerCycle: 0, aerobicMinPerCycle: 0 },
  // Build = the former development week at cycle 0.
  build: { forceLoad: "MODERATE", forceDoseStep: "MODERATE", forceDurationMin: 60, dhLoad: "MODERATE", dhDurationMin: 90, dhFocusedPasses: 6, aerobicLoad: "MODERATE", aerobicBaseDurationMin: 45, dhPassesPerCycle: 1, aerobicMinPerCycle: 15 },
  // Overload: Force +1 set / RPE 8 (same load profile), DH +1 pass, endurance +15 min.
  build_plus: { forceLoad: "MODERATE", forceDoseStep: "MODERATE_PLUS", forceDurationMin: 60, dhLoad: "MODERATE", dhDurationMin: 90, dhFocusedPasses: 7, aerobicLoad: "MODERATE", aerobicBaseDurationMin: 60, dhPassesPerCycle: 1, aerobicMinPerCycle: 15 },
  // Unload after the overload (deload template: no endurance slot).
  consolidation: { forceLoad: "LIGHT", forceDoseStep: "LIGHT", forceDurationMin: 45, dhLoad: "LIGHT", dhDurationMin: 60, dhFocusedPasses: 4, aerobicLoad: "LIGHT", aerobicBaseDurationMin: 45, dhPassesPerCycle: 0, aerobicMinPerCycle: 0 },
  // Two weeks before a race: riding first (max passes), strength maintained, no overload.
  race_specific: { forceLoad: "MODERATE", forceDoseStep: "MODERATE", forceDurationMin: 60, dhLoad: "MODERATE", dhDurationMin: 90, dhFocusedPasses: 8, aerobicLoad: "MODERATE", aerobicBaseDurationMin: 45, dhPassesPerCycle: 0, aerobicMinPerCycle: 0 },
  // = PLAN_DOSE_POLICY_V2.taper (written out: no module-level reference, so bundles that only read the version stay free of the policy; equality locked by test).
  taper: { forceLoad: "LIGHT", forceDoseStep: "LIGHT", forceDurationMin: 45, dhLoad: "LIGHT", dhDurationMin: 60, dhFocusedPasses: 4, aerobicLoad: "LIGHT", aerobicBaseDurationMin: 45, dhPassesPerCycle: 0, aerobicMinPerCycle: 0 },
};

/**
 * Upper bounds of the progression = the builders' own ranges (DH drill 4–8
 * passes; endurance_base_continuous 45–90 min). Availability adaptation
 * steps down by AEROBIC_STEP_MIN, never below the minimum.
 */
export const PLAN_PROGRESSION_CAPS_V2 = { dhPassesMax: 8, aerobicMinMin: 45, aerobicMaxMin: 90, aerobicStepMin: 15 } as const;

/**
 * Availability adaptation of a DH session (shorter window → shorter session,
 * fewer passes): duration → maximum passes at that duration.
 */
export const PLAN_DH_DURATION_STEPS_V2: readonly { durationMin: number; maxPasses: number }[] = [
  { durationMin: 90, maxPasses: 8 },
  { durationMin: 75, maxPasses: 6 },
  { durationMin: 60, maxPasses: 5 },
];

/** Recent training volume (minutes over the recent-load window) from which the block starts at build, without an introduction week. */
export const PLAN_RECENT_TRAINING_MINUTES_V2 = 180;
/** Missed or replaced sessions from which the first overload week is held at build. */
export const PLAN_MISSED_SESSIONS_HOLD_V2 = 2;
