/**
 * PHYS-04 — bodyweight repetitions guidance (PROVISIONAL sport parameters, validation by a qualified coach
 * required). Outside the Session Model V2 manifest: an advisory addition to a daily final Force prescription
 * (never a planned dose), traced by its rules version. Same reference window and effort margin as the Force
 * load guidance (strengthLoadGuidancePolicyV2), so both read the rider's history the same way.
 */
export const BODYWEIGHT_REPS_GUIDANCE_RULES_VERSION = "bodyweight-reps-guidance-v1";

export const BODYWEIGHT_REPS_GUIDANCE_POLICY_V2 = {
  /** The reference session is no older than this (days before today). */
  maxReferenceAgeDays: 28,
  /** RPE at or above the target's maximum + this margin is "effort too high". */
  effortTooHighMargin: 2,
  /** Repetitions added per set when progressing (never above the prescribed range). */
  repsStep: 1,
  validationStatus: "PROVISIONAL",
} as const;
