/**
 * UX-11A.5a.1 — Session Model V2 exercise catalogue: strength (lower and
 * upper body), unilateral, secondary posterior chain, prevention / core,
 * grip, activation and power.
 *
 * STRICT V1 / V2 ISOLATION (ADR UX-11A.5a.1):
 * - This catalogue is separate from exerciseCatalog.ts (V1, version "v3"),
 *   which stays byte-for-byte unchanged and keeps driving every V1 plan.
 * - It has its own version (SESSION_EXERCISE_CATALOG_V2_VERSION) and is not
 *   read by any engine yet (planning-engine / prescription-engine V1 paths
 *   never import it). V2-only exercises can therefore never appear in a V1
 *   plan.
 * - Historical exercises keep their exerciseId ("v1_enriched"): this file
 *   only adds Session Model V2 metadata next to them; their V1 entry — dose
 *   included (the four legacy AMRAP doses stay AMRAP for V1) — is untouched.
 *   Their required equipment must stay identical to V1.
 *
 * Mobility / breathing exercises used by protocols come with UX-11A.5a.3;
 * DH drills stay in drillCatalog.ts (UX-11A.5a.2).
 *
 * Vocabulary (docs/03_COACHING_MODEL.md §Modèle de séance NALYNT V1):
 * roles map to "échauffement" (warm_up), "activation", "principal",
 * "secondaire" (secondary), "unilatéral" (unilateral), "prévention ou
 * gainage" (prevention — grip belongs here, Force family) and "explosif"
 * (explosive).
 *
 * referencePrescription = the exercise's reference dose for its FIRST role,
 * at "charge modérée", within the role envelope of 03 (checked by tests).
 * Never a load in kg.
 *
 * Every entry: PROVISIONAL — coaching validation required. Nothing is
 * VALIDATED because it already existed in V1.
 */
import type { StrengthExperienceTier } from "../types/planInputSnapshot.js";
import type { ContentValidationStatus } from "./coachingTextCatalog.js";

export const SESSION_EXERCISE_CATALOG_V2_VERSION = "session-exercises-v2.0";

export const SESSION_EXERCISE_ROLES_V2 = ["warm_up", "activation", "principal", "secondary", "unilateral", "prevention", "explosive"] as const;
export type SessionExerciseRoleV2 = (typeof SESSION_EXERCISE_ROLES_V2)[number];

export const SESSION_EXERCISE_FAMILIES_V2 = [
  "squat",
  "hinge",
  "lunge",
  "push",
  "pull",
  "shoulder_health",
  "carry",
  "grip",
  "core",
  "lower_leg",
  "adductor",
  "plyometric",
] as const;
export type SessionExerciseFamilyV2 = (typeof SESSION_EXERCISE_FAMILIES_V2)[number];

export const SESSION_TIERS_V2: readonly StrengthExperienceTier[] = ["beginner", "intermediate", "advanced"];

/** Same measure vocabulary as a V2 set result, minus the DH "pass" (drills live in drillCatalog.ts). */
export const SESSION_MEASURE_TYPES_V2 = ["reps", "duration", "distance"] as const;
export type SessionMeasureTypeV2 = (typeof SESSION_MEASURE_TYPES_V2)[number];

export interface RangeV2 {
  min: number;
  max: number;
}

/** Exactly one volume field, matching the entry's measureType. */
export interface ReferencePrescriptionV2 {
  sets: RangeV2;
  reps?: RangeV2;
  durationSeconds?: RangeV2;
  distanceMeters?: RangeV2;
  restSeconds: RangeV2;
}

export interface SessionExerciseV2 {
  exerciseId: string;
  /** "v1_enriched": same id as a V1 entry, metadata only. "v2_only": never in the V1 catalogue. */
  origin: "v1_enriched" | "v2_only";
  family: SessionExerciseFamilyV2;
  /** Roles this exercise may play in a session; the first one is its reference role. */
  roles: readonly SessionExerciseRoleV2[];
  /** Explicit levels (not inferred from a progression chain). */
  tiers: readonly StrengthExperienceTier[];
  /** Closed vocabulary of the athlete's declared equipment; [] = none needed. */
  requiredEquipment: readonly string[];
  optionalEquipment: readonly string[];
  measureType: SessionMeasureTypeV2;
  /** Volume expressed per side (unilateral work). */
  perSide: boolean;
  referencePrescription: ReferencePrescriptionV2;
  cueId: string;
  vigilanceIds: readonly string[];
  progressesTo?: string;
  regressesTo?: string;
  substitutions: readonly string[];
  validationStatus: ContentValidationStatus;
}

const r = (min: number, max: number): RangeV2 => ({ min, max });

// Reference doses at "charge modérée", per first role (03 role table).
const PRINCIPAL = { sets: r(3, 5), reps: r(6, 8), restSeconds: r(120, 180) };
const SECONDARY = { sets: r(3, 4), reps: r(8, 12), restSeconds: r(90, 90) };
const UNILATERAL = { sets: r(3, 4), reps: r(8, 12), restSeconds: r(60, 90) };
const PREVENTION_REPS = { sets: r(2, 4), reps: r(12, 20), restSeconds: r(45, 60) };
const EXPLOSIVE = { sets: r(3, 5), reps: r(3, 5), restSeconds: r(120, 180) };

type EntryInput = Omit<SessionExerciseV2, "validationStatus" | "optionalEquipment" | "substitutions" | "vigilanceIds" | "perSide" | "cueId"> &
  Partial<Pick<SessionExerciseV2, "optionalEquipment" | "substitutions" | "vigilanceIds" | "perSide">>;

function entry(input: EntryInput): SessionExerciseV2 {
  return {
    optionalEquipment: [],
    substitutions: [],
    vigilanceIds: [],
    perSide: false,
    ...input,
    cueId: `cue.${input.exerciseId}`,
    validationStatus: "PROVISIONAL",
  };
}

const ENTRIES: SessionExerciseV2[] = [
  // ---------------------------------------------------------------- squat / hinge
  entry({ exerciseId: "bodyweight_squat", origin: "v1_enriched", family: "squat", roles: ["warm_up", "principal"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", referencePrescription: { sets: r(1, 2), reps: r(10, 15), restSeconds: r(0, 30) }, progressesTo: "goblet_squat" }),
  entry({ exerciseId: "goblet_squat", origin: "v1_enriched", family: "squat", roles: ["principal", "secondary"], tiers: ["intermediate"], requiredEquipment: ["dumbbells"], measureType: "reps", referencePrescription: PRINCIPAL, vigilanceIds: ["vigilance.knee_pain_free_range"], progressesTo: "barbell_back_squat", regressesTo: "bodyweight_squat" }),
  entry({ exerciseId: "barbell_back_squat", origin: "v1_enriched", family: "squat", roles: ["principal"], tiers: ["advanced"], requiredEquipment: ["barbell", "squat_rack"], measureType: "reps", referencePrescription: PRINCIPAL, vigilanceIds: ["vigilance.back_stable_technique"], regressesTo: "goblet_squat" }),
  entry({ exerciseId: "bodyweight_hip_hinge", origin: "v1_enriched", family: "hinge", roles: ["warm_up"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", referencePrescription: { sets: r(1, 2), reps: r(10, 12), restSeconds: r(0, 30) }, progressesTo: "dumbbell_romanian_deadlift" }),
  entry({ exerciseId: "glute_bridge", origin: "v2_only", family: "hinge", roles: ["activation", "secondary"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", referencePrescription: { sets: r(2, 3), reps: r(12, 15), restSeconds: r(30, 45) }, progressesTo: "dumbbell_hip_thrust" }),
  entry({ exerciseId: "dumbbell_romanian_deadlift", origin: "v1_enriched", family: "hinge", roles: ["secondary", "principal"], tiers: ["intermediate"], requiredEquipment: ["dumbbells"], measureType: "reps", referencePrescription: SECONDARY, vigilanceIds: ["vigilance.back_stop_before_rounding"], progressesTo: "barbell_romanian_deadlift", regressesTo: "bodyweight_hip_hinge" }),
  entry({ exerciseId: "barbell_romanian_deadlift", origin: "v2_only", family: "hinge", roles: ["secondary"], tiers: ["advanced"], requiredEquipment: ["barbell"], measureType: "reps", referencePrescription: SECONDARY, vigilanceIds: ["vigilance.back_stop_before_rounding"], regressesTo: "dumbbell_romanian_deadlift" }),
  entry({ exerciseId: "barbell_deadlift", origin: "v1_enriched", family: "hinge", roles: ["principal"], tiers: ["advanced"], requiredEquipment: ["barbell"], measureType: "reps", referencePrescription: PRINCIPAL, vigilanceIds: ["vigilance.back_stable_technique"], regressesTo: "dumbbell_romanian_deadlift" }),
  entry({ exerciseId: "dumbbell_hip_thrust", origin: "v2_only", family: "hinge", roles: ["secondary"], tiers: ["intermediate"], requiredEquipment: ["dumbbells", "bench"], measureType: "reps", referencePrescription: SECONDARY, regressesTo: "glute_bridge" }),

  // ---------------------------------------------------------------- unilateral / lower-leg prevention
  entry({ exerciseId: "reverse_lunge", origin: "v2_only", family: "lunge", roles: ["unilateral"], tiers: ["beginner", "intermediate"], requiredEquipment: [], optionalEquipment: ["dumbbells"], measureType: "reps", perSide: true, referencePrescription: UNILATERAL, vigilanceIds: ["vigilance.knee_pain_free_range"], progressesTo: "bulgarian_split_squat", substitutions: ["step_up"] }),
  entry({ exerciseId: "step_up", origin: "v2_only", family: "lunge", roles: ["unilateral"], tiers: ["intermediate"], requiredEquipment: ["bench"], optionalEquipment: ["dumbbells"], measureType: "reps", perSide: true, referencePrescription: UNILATERAL, vigilanceIds: ["vigilance.knee_pain_free_range"], substitutions: ["reverse_lunge"] }),
  entry({ exerciseId: "bulgarian_split_squat", origin: "v2_only", family: "lunge", roles: ["unilateral"], tiers: ["intermediate", "advanced"], requiredEquipment: ["bench"], optionalEquipment: ["dumbbells"], measureType: "reps", perSide: true, referencePrescription: { ...UNILATERAL, reps: r(6, 10) }, vigilanceIds: ["vigilance.knee_pain_free_range"], regressesTo: "reverse_lunge" }),
  entry({ exerciseId: "single_leg_romanian_deadlift", origin: "v2_only", family: "hinge", roles: ["unilateral"], tiers: ["intermediate"], requiredEquipment: [], optionalEquipment: ["dumbbells"], measureType: "reps", perSide: true, referencePrescription: { ...UNILATERAL, reps: r(8, 10) }, vigilanceIds: ["vigilance.balance_support_allowed"], regressesTo: "bodyweight_hip_hinge" }),
  entry({ exerciseId: "single_leg_calf_raise", origin: "v2_only", family: "lower_leg", roles: ["prevention"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", perSide: true, referencePrescription: PREVENTION_REPS, vigilanceIds: ["vigilance.achilles_pain_free"] }),
  entry({ exerciseId: "copenhagen_plank_short", origin: "v2_only", family: "adductor", roles: ["prevention"], tiers: ["intermediate"], requiredEquipment: ["bench"], measureType: "duration", perSide: true, referencePrescription: { sets: r(2, 3), durationSeconds: r(15, 30), restSeconds: r(45, 60) }, vigilanceIds: ["vigilance.groin_stop_on_pain"] }),

  // ---------------------------------------------------------------- upper body
  entry({ exerciseId: "floor_ytw_raise", origin: "v1_enriched", family: "shoulder_health", roles: ["warm_up", "prevention"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", referencePrescription: { sets: r(1, 2), reps: r(8, 8), restSeconds: r(0, 30) }, vigilanceIds: ["vigilance.shoulder_pain_free"], progressesTo: "band_face_pull" }),
  entry({ exerciseId: "band_pull_apart", origin: "v2_only", family: "shoulder_health", roles: ["warm_up", "prevention"], tiers: ["beginner"], requiredEquipment: ["resistance_bands"], measureType: "reps", referencePrescription: { sets: r(1, 2), reps: r(15, 20), restSeconds: r(0, 30) } }),
  entry({ exerciseId: "band_face_pull", origin: "v2_only", family: "shoulder_health", roles: ["prevention"], tiers: ["beginner"], requiredEquipment: ["resistance_bands"], measureType: "reps", referencePrescription: { ...PREVENTION_REPS, reps: r(12, 15) }, vigilanceIds: ["vigilance.shoulder_pain_free"], regressesTo: "floor_ytw_raise" }),
  entry({ exerciseId: "resistance_band_row", origin: "v1_enriched", family: "pull", roles: ["secondary"], tiers: ["beginner"], requiredEquipment: ["resistance_bands"], measureType: "reps", referencePrescription: { ...SECONDARY, reps: r(12, 12) }, progressesTo: "lat_pulldown", substitutions: ["inverted_row"] }),
  entry({ exerciseId: "inverted_row", origin: "v2_only", family: "pull", roles: ["secondary", "principal"], tiers: ["intermediate"], requiredEquipment: ["barbell", "squat_rack"], measureType: "reps", referencePrescription: SECONDARY, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain"], progressesTo: "pull_up", substitutions: ["resistance_band_row"] }),
  entry({ exerciseId: "one_arm_dumbbell_row", origin: "v2_only", family: "pull", roles: ["unilateral", "secondary"], tiers: ["intermediate"], requiredEquipment: ["dumbbells", "bench"], measureType: "reps", perSide: true, referencePrescription: UNILATERAL }),
  entry({ exerciseId: "lat_pulldown", origin: "v1_enriched", family: "pull", roles: ["secondary", "principal"], tiers: ["intermediate"], requiredEquipment: ["cable_machine"], measureType: "reps", referencePrescription: SECONDARY, progressesTo: "pull_up", regressesTo: "resistance_band_row", substitutions: ["pull_up"] }),
  entry({ exerciseId: "pull_up", origin: "v1_enriched", family: "pull", roles: ["principal"], tiers: ["advanced"], requiredEquipment: ["pull_up_bar"], measureType: "reps", referencePrescription: PRINCIPAL, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain", "vigilance.shoulder_pain_free"], regressesTo: "lat_pulldown", substitutions: ["lat_pulldown"] }),
  entry({ exerciseId: "pushup", origin: "v1_enriched", family: "push", roles: ["secondary", "principal", "warm_up"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", referencePrescription: SECONDARY, vigilanceIds: ["vigilance.wrist_support_alternative"], progressesTo: "dumbbell_bench_press" }),
  entry({ exerciseId: "dumbbell_bench_press", origin: "v1_enriched", family: "push", roles: ["principal", "secondary"], tiers: ["intermediate"], requiredEquipment: ["dumbbells", "bench"], measureType: "reps", referencePrescription: PRINCIPAL, vigilanceIds: ["vigilance.shoulder_pain_free"], progressesTo: "barbell_bench_press", regressesTo: "pushup", substitutions: ["barbell_bench_press"] }),
  entry({ exerciseId: "barbell_bench_press", origin: "v1_enriched", family: "push", roles: ["principal"], tiers: ["advanced"], requiredEquipment: ["barbell", "bench"], measureType: "reps", referencePrescription: PRINCIPAL, vigilanceIds: ["vigilance.shoulder_pain_free"], regressesTo: "dumbbell_bench_press", substitutions: ["dumbbell_bench_press"] }),
  entry({ exerciseId: "half_kneeling_dumbbell_press", origin: "v2_only", family: "push", roles: ["unilateral"], tiers: ["intermediate"], requiredEquipment: ["dumbbells"], measureType: "reps", perSide: true, referencePrescription: { ...UNILATERAL, reps: r(8, 10) }, vigilanceIds: ["vigilance.shoulder_pain_free"] }),

  // ---------------------------------------------------------------- grip / carry / core
  entry({ exerciseId: "dead_hang", origin: "v2_only", family: "grip", roles: ["prevention"], tiers: ["beginner", "intermediate"], requiredEquipment: ["pull_up_bar"], measureType: "duration", referencePrescription: { sets: r(2, 3), durationSeconds: r(20, 45), restSeconds: r(45, 60) }, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain", "vigilance.grip_race_week"] }),
  entry({ exerciseId: "farmer_carry", origin: "v1_enriched", family: "carry", roles: ["prevention"], tiers: ["intermediate"], requiredEquipment: ["dumbbells"], measureType: "duration", referencePrescription: { sets: r(3, 3), durationSeconds: r(30, 40), restSeconds: r(60, 90) }, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain", "vigilance.grip_race_week"], substitutions: ["suitcase_carry"] }),
  entry({ exerciseId: "suitcase_carry", origin: "v1_enriched", family: "carry", roles: ["prevention"], tiers: ["intermediate"], requiredEquipment: ["dumbbells"], measureType: "duration", perSide: true, referencePrescription: { sets: r(3, 3), durationSeconds: r(30, 30), restSeconds: r(60, 90) }, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain"], substitutions: ["farmer_carry"] }),
  entry({ exerciseId: "plank", origin: "v1_enriched", family: "core", roles: ["prevention"], tiers: ["beginner"], requiredEquipment: [], measureType: "duration", referencePrescription: { sets: r(2, 3), durationSeconds: r(30, 45), restSeconds: r(45, 60) }, progressesTo: "side_plank" }),
  entry({ exerciseId: "side_plank", origin: "v2_only", family: "core", roles: ["prevention"], tiers: ["beginner"], requiredEquipment: [], measureType: "duration", perSide: true, referencePrescription: { sets: r(2, 3), durationSeconds: r(20, 40), restSeconds: r(45, 60) }, vigilanceIds: ["vigilance.shoulder_pain_free"], regressesTo: "plank" }),
  entry({ exerciseId: "dead_bug", origin: "v2_only", family: "core", roles: ["activation", "prevention"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", perSide: true, referencePrescription: { sets: r(2, 3), reps: r(8, 10), restSeconds: r(30, 45) } }),
  entry({ exerciseId: "bird_dog", origin: "v2_only", family: "core", roles: ["activation"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", perSide: true, referencePrescription: { sets: r(2, 2), reps: r(8, 8), restSeconds: r(30, 30) }, vigilanceIds: ["vigilance.wrist_support_alternative"] }),
  entry({ exerciseId: "pallof_press", origin: "v1_enriched", family: "core", roles: ["prevention"], tiers: ["intermediate"], requiredEquipment: ["resistance_bands"], measureType: "reps", perSide: true, referencePrescription: { ...PREVENTION_REPS, reps: r(12, 12) }, regressesTo: "plank" }),
  entry({ exerciseId: "hanging_leg_raise", origin: "v1_enriched", family: "core", roles: ["prevention"], tiers: ["advanced"], requiredEquipment: ["pull_up_bar"], measureType: "reps", referencePrescription: { ...PREVENTION_REPS, sets: r(2, 3), reps: r(12, 15) }, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain"], regressesTo: "plank" }),
  entry({ exerciseId: "bear_crawl", origin: "v1_enriched", family: "core", roles: ["warm_up", "activation"], tiers: ["beginner"], requiredEquipment: [], measureType: "duration", referencePrescription: { sets: r(2, 2), durationSeconds: r(20, 30), restSeconds: r(30, 45) }, vigilanceIds: ["vigilance.wrist_support_alternative"] }),

  // ---------------------------------------------------------------- power
  entry({ exerciseId: "pogo_hops", origin: "v2_only", family: "plyometric", roles: ["activation"], tiers: ["beginner"], requiredEquipment: [], measureType: "reps", referencePrescription: { sets: r(2, 2), reps: r(15, 20), restSeconds: r(45, 60) }, vigilanceIds: ["vigilance.achilles_pain_free"] }),
  entry({ exerciseId: "squat_jump", origin: "v2_only", family: "plyometric", roles: ["explosive"], tiers: ["intermediate"], requiredEquipment: [], measureType: "reps", referencePrescription: EXPLOSIVE, vigilanceIds: ["vigilance.knee_pain_free_range", "vigilance.power_stop_on_quality_loss"], progressesTo: "broad_jump" }),
  entry({ exerciseId: "broad_jump", origin: "v2_only", family: "plyometric", roles: ["explosive"], tiers: ["intermediate"], requiredEquipment: [], measureType: "reps", referencePrescription: { ...EXPLOSIVE, sets: r(3, 4), reps: r(3, 3) }, vigilanceIds: ["vigilance.knee_pain_free_range", "vigilance.power_stop_on_quality_loss"], regressesTo: "squat_jump" }),
  entry({ exerciseId: "skater_jump", origin: "v2_only", family: "plyometric", roles: ["explosive"], tiers: ["intermediate"], requiredEquipment: [], measureType: "reps", perSide: true, referencePrescription: { ...EXPLOSIVE, sets: r(3, 3) }, vigilanceIds: ["vigilance.ankle_knee_landing", "vigilance.power_stop_on_quality_loss"] }),
  entry({ exerciseId: "dumbbell_swing", origin: "v2_only", family: "hinge", roles: ["explosive"], tiers: ["intermediate"], requiredEquipment: ["dumbbells"], measureType: "reps", referencePrescription: { ...EXPLOSIVE, sets: r(3, 4), reps: r(5, 5) }, vigilanceIds: ["vigilance.back_stable_technique", "vigilance.power_stop_on_quality_loss"] }),
  entry({ exerciseId: "plyo_pushup", origin: "v2_only", family: "plyometric", roles: ["explosive"], tiers: ["advanced"], requiredEquipment: [], measureType: "reps", referencePrescription: { ...EXPLOSIVE, sets: r(3, 3) }, vigilanceIds: ["vigilance.wrist_thumb_stop_on_pain", "vigilance.power_stop_on_quality_loss"], regressesTo: "pushup" }),
];

export const SESSION_EXERCISE_CATALOG_V2_ENTRIES: readonly SessionExerciseV2[] = ENTRIES;

export const SESSION_EXERCISE_CATALOG_V2: Readonly<Record<string, SessionExerciseV2>> = Object.fromEntries(
  ENTRIES.map((e) => [e.exerciseId, e])
);
