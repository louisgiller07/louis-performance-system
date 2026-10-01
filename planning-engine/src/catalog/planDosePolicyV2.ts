/**
 * UX-11A.5a.4 — V2 Plan Dose Policy: the V2 dose of each session domain per
 * planner week type.
 *
 * - development: Force MODERATE, DH 6 passages, endurance base 45 min;
 * - taper: Force LIGHT, DH 4 passages, endurance base 45 min;
 * - race: the current planner places no normal session (template with zero
 *   slots), so the policy defines none.
 *
 * This policy deliberately does NOT reuse the legacy HistoryAdjuster
 * decrements (−10 min, −1 passage, −2 sets, −1 RPE, LIGHT step-down) nor the
 * legacy taper durations: it can never produce 20 / 30 / 35 min or 3 / 5
 * passages. historyAdjuster.ts itself is unchanged and keeps driving V1.
 *
 * Not read by any engine yet. Every value: PROVISIONAL — coaching
 * validation required.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { StrengthLoadLevelV2 } from "./strengthDoseCatalogV2.js";

export const PLAN_DOSE_POLICY_V2_VERSION = "plan-dose-policy-v2.0";

export interface PlanWeekDoseV2 {
  forceLoad: StrengthLoadLevelV2;
  dhFocusedPasses: number;
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
  development: { forceLoad: "MODERATE", dhFocusedPasses: 6, aerobicBaseDurationMin: 45 },
  taper: { forceLoad: "LIGHT", dhFocusedPasses: 4, aerobicBaseDurationMin: 45 },
  race: null,
  validationStatus: "PROVISIONAL",
};
