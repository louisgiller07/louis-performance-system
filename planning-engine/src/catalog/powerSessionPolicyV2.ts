/**
 * PHYS-03 — the power (explosiveness) session and where a V2 plan places it
 * (PROVISIONAL sport parameters, validation by a qualified coach required).
 *
 * Outside the Session Model V2 manifest on purpose, like the intervals
 * placement: it COMPOSES existing catalogue content (exercises, their
 * reference doses, cues and vigilances; the lower-body Force warm-up; the
 * Force cool-down) and never changes a catalogue. The power session is the
 * docs/03 §5 envelope: 3 to 4 explosive exercises, 3–5 sets of 3–5 reps,
 * full rest (2–3 min), the set stops as soon as speed drops.
 *
 * No load in kg, no jump height, no technical difficulty is ever prescribed:
 * the exercise's own catalogue reference (reps, rest) is the dose.
 */
import type { WeekProgressionRole } from "../types/planWeek.js";

export const POWER_SESSION_POLICY_V2_VERSION = "power-session-v1";

export const POWER_SESSION_POLICY_V2 = {
  /** docs/03 §5 — explosive exercises per session (fewer available → no power session). */
  explosiveExercises: { min: 3, max: 4 },
  /** The plyometric activation that closes the warm-up (catalogue role `activation`). */
  activationExerciseId: "pogo_hops",
  /** The warm-up is the lower-body Force template's for the rider's tier (mobility then activation). */
  warmUpTemplateKind: "STRENGTH_LOWER",
  /** Cool-down: the lower-body Force cool-down (strengthDailyCatalogV2). */
  coolDownKind: "STRENGTH_LOWER",
  validationStatus: "PROVISIONAL",
} as const;

export const POWER_PLAN_POLICY_V2_VERSION = "power-plan-v1";

export const POWER_PLAN_POLICY_V2: {
  /** The week roles whose first Force slot (lower body) becomes the power session. */
  readonly weekRoles: readonly WeekProgressionRole[];
  /**
   * docs/03 §5 « jamais après une séance fatigante »: never the day after a development session as M1 defines it
   * (Force, power, grip, intervals, DH performance at MODERATE or HEAVY).
   */
  readonly developmentKinds: readonly string[];
  readonly validationStatus: "PROVISIONAL";
} = {
  weekRoles: ["build"],
  developmentKinds: ["STRENGTH_LOWER", "STRENGTH_UPPER", "POWER", "GRIP_WORK", "AEROBIC_INTERVALS", "DH_PERFORMANCE"],
  validationStatus: "PROVISIONAL",
};
