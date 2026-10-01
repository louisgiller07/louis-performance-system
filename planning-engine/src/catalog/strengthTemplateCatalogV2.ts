/**
 * UX-11A.5a.4 — Strength session templates V2 (STRENGTH_LOWER / STRENGTH_UPPER
 * × beginner / intermediate / advanced).
 *
 * Architecture (validated, ADR UX-11A.5a.4):
 * - one template per session kind × athlete tier (cumulative tiers, V2 only);
 * - an explicit warm-up (strength_warm_up_v1: mobility + activation);
 * - exactly three work slots, each with a role and an ORDERED candidate
 *   list. The order is versioned content: the future builder will take the
 *   first candidate allowed for the athlete's tier (cumulative) whose
 *   required equipment is declared. The order is never derived from the
 *   exercise catalogue order, progressesTo, regressesTo or substitutions.
 *   No compatible candidate at runtime → `no_compatible_strength_exercise`
 *   (a builder block, not a catalogue error).
 *
 * Families (PROVISIONAL): LOWER = squat, hinge, lunge, lower_leg, adductor,
 * carry; UPPER = push, pull, shoulder_health; core = transversal
 * prevention / trunk control; grip and plyometric excluded for now. The
 * legacy V1 movement-category mapping is unchanged.
 *
 * Content (exercise choices and their order): PROVISIONAL — coaching
 * validation required. Not read by any engine yet (no Force builder).
 */
import type { StrengthExperienceTier } from "../types/planInputSnapshot.js";
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { SessionExerciseFamilyV2 } from "./sessionExerciseCatalogV2.js";

export const STRENGTH_TEMPLATE_CATALOG_V2_VERSION = "strength-templates-v2.0";

export const STRENGTH_TEMPLATE_SESSION_KINDS_V2 = ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const;
export type StrengthTemplateSessionKindV2 = (typeof STRENGTH_TEMPLATE_SESSION_KINDS_V2)[number];

/** Exercise families per strength session kind (PROVISIONAL), plus the transversal trunk family. */
export const STRENGTH_FAMILIES_V2: Readonly<Record<StrengthTemplateSessionKindV2, readonly SessionExerciseFamilyV2[]>> = {
  STRENGTH_LOWER: ["squat", "hinge", "lunge", "lower_leg", "adductor", "carry"],
  STRENGTH_UPPER: ["push", "pull", "shoulder_health"],
};
export const STRENGTH_TRANSVERSAL_FAMILIES_V2: readonly SessionExerciseFamilyV2[] = ["core"];
export const STRENGTH_EXCLUDED_FAMILIES_V2: readonly SessionExerciseFamilyV2[] = ["grip", "plyometric"];

/** Work slot role = the exercise role it plays (and the dose row it will take in strengthDoseCatalogV2). */
export const STRENGTH_WORK_SLOT_ROLES_V2 = ["principal", "secondary", "unilateral", "prevention"] as const;
export type StrengthWorkSlotRoleV2 = (typeof STRENGTH_WORK_SLOT_ROLES_V2)[number];

export interface StrengthWorkSlotV2 {
  /** Block of the v2 prescription the slot lands in: the principal goes to `main`, the others to `complementary`. */
  blockRole: "main" | "complementary";
  role: StrengthWorkSlotRoleV2;
  /** Ordered, versioned content: first candidate allowed for the tier and the declared equipment wins (future builder). */
  candidates: readonly string[];
}

/** Explicit warm-up of the template, within the strength_warm_up_v1 protocol constraints. */
export interface StrengthWarmUpV2 {
  protocolId: "strength_warm_up_v1";
  mobility: readonly string[];
  activation: readonly string[];
}

export interface StrengthTemplateV2 {
  templateId: string;
  sessionKind: StrengthTemplateSessionKindV2;
  athleteTier: StrengthExperienceTier;
  warmUp: StrengthWarmUpV2;
  workSlots: readonly [StrengthWorkSlotV2, StrengthWorkSlotV2, StrengthWorkSlotV2];
  validationStatus: ContentValidationStatus;
}

const LOWER_WARM_UP: StrengthWarmUpV2 = { protocolId: "strength_warm_up_v1", mobility: ["hip_90_90", "knee_to_wall_ankle"], activation: ["bird_dog"] };
const UPPER_WARM_UP: StrengthWarmUpV2 = { protocolId: "strength_warm_up_v1", mobility: ["thoracic_rotation_mobility", "wrist_mobility"], activation: ["bear_crawl"] };

const main = (...candidates: string[]): StrengthWorkSlotV2 => ({ blockRole: "main", role: "principal", candidates });
const secondary = (...candidates: string[]): StrengthWorkSlotV2 => ({ blockRole: "complementary", role: "secondary", candidates });
const unilateral = (...candidates: string[]): StrengthWorkSlotV2 => ({ blockRole: "complementary", role: "unilateral", candidates });
const prevention = (...candidates: string[]): StrengthWorkSlotV2 => ({ blockRole: "complementary", role: "prevention", candidates });

function template(
  sessionKind: StrengthTemplateSessionKindV2,
  athleteTier: StrengthExperienceTier,
  warmUp: StrengthWarmUpV2,
  workSlots: StrengthTemplateV2["workSlots"]
): StrengthTemplateV2 {
  const kind = sessionKind === "STRENGTH_LOWER" ? "lower" : "upper";
  return { templateId: `strength_${kind}_${athleteTier}_v1`, sessionKind, athleteTier, warmUp, workSlots, validationStatus: "PROVISIONAL" };
}

const ENTRIES: StrengthTemplateV2[] = [
  // ---------------------------------------------------------------- LOWER
  template("STRENGTH_LOWER", "beginner", LOWER_WARM_UP, [main("bodyweight_squat"), secondary("glute_bridge"), unilateral("reverse_lunge")]),
  template("STRENGTH_LOWER", "intermediate", LOWER_WARM_UP, [
    main("goblet_squat", "bodyweight_squat"),
    secondary("dumbbell_romanian_deadlift", "dumbbell_hip_thrust", "glute_bridge"),
    unilateral("bulgarian_split_squat", "step_up", "single_leg_romanian_deadlift", "reverse_lunge"),
  ]),
  template("STRENGTH_LOWER", "advanced", LOWER_WARM_UP, [
    main("barbell_back_squat", "barbell_deadlift", "goblet_squat", "bodyweight_squat"),
    secondary("barbell_romanian_deadlift", "dumbbell_romanian_deadlift", "dumbbell_hip_thrust", "glute_bridge"),
    unilateral("bulgarian_split_squat", "step_up", "single_leg_romanian_deadlift", "reverse_lunge"),
  ]),
  // ---------------------------------------------------------------- UPPER
  // The secondary lists end with floor_ytw_raise, whose catalogue roles are
  // warm_up / prevention, not secondary: an OPEN role question kept visible
  // (ADR UX-11A.5a.4), never silently resolved.
  template("STRENGTH_UPPER", "beginner", UPPER_WARM_UP, [main("pushup"), secondary("resistance_band_row", "floor_ytw_raise"), prevention("dead_bug")]),
  template("STRENGTH_UPPER", "intermediate", UPPER_WARM_UP, [
    main("dumbbell_bench_press", "pushup"),
    secondary("one_arm_dumbbell_row", "lat_pulldown", "inverted_row", "resistance_band_row", "floor_ytw_raise"),
    prevention("pallof_press", "dead_bug"),
  ]),
  template("STRENGTH_UPPER", "advanced", UPPER_WARM_UP, [
    main("barbell_bench_press", "dumbbell_bench_press", "pull_up", "pushup"),
    secondary("lat_pulldown", "one_arm_dumbbell_row", "inverted_row", "resistance_band_row", "floor_ytw_raise"),
    prevention("hanging_leg_raise", "pallof_press", "dead_bug"),
  ]),
];

export const STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES: readonly StrengthTemplateV2[] = ENTRIES;

export const STRENGTH_TEMPLATE_CATALOG_V2: Readonly<Record<string, StrengthTemplateV2>> = Object.fromEntries(ENTRIES.map((t) => [t.templateId, t]));
