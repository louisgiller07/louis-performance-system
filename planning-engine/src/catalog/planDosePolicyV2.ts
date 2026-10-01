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
 * Every value: PROVISIONAL — coaching validation required.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { StrengthLoadLevelV2 } from "./strengthDoseCatalogV2.js";

/** Session load levels a V2 policy may assign (HEAVY out of scope). */
export type PlanLoadV2 = "LIGHT" | "MODERATE";

export const PLAN_DOSE_POLICY_V2_VERSION = "plan-dose-policy-v2.3";

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
