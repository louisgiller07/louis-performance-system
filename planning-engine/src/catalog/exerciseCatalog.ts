/**
 * Versioned, code-based exercise registry (M0 §5 / M1 §5). Deliberately a
 * small, realistic V1 set — enough to represent the golden scenarios
 * (tests/fixtures/) and prove the model, not a complete coaching library.
 *
 * IDs are permanent. A meaningful change to an entry ships as a NEW id; the
 * old one is marked `deprecated: true, replacedBy` and is NEVER deleted or
 * repurposed — see README.md "Catalogue versioning rules".
 */

export const EXERCISE_CATALOG_VERSION = "v1";

export type MovementCategory = "squat" | "hinge" | "push" | "pull" | "carry" | "core" | "mobility";

export type PrescriptionModality = "fixed_reps" | "rep_range" | "time" | "amrap";

export interface ExerciseCatalogEntry {
  id: string;
  displayName: string;
  movementCategory: MovementCategory;
  /** Closed-vocabulary equipment tags — matches PlanInputSnapshot.equipment's vocabulary. Empty array = no equipment needed (bodyweight). */
  equipmentRequirements: string[];
  supportedModalities: PrescriptionModality[];
  /** Other exerciseIds this can substitute for/be substituted by — symmetric in practice for this V1 set. */
  substitutions: string[];
  progressesTo?: string;
  regressesTo?: string;
  deprecated?: boolean;
  replacedBy?: string;
}

const ENTRIES: ExerciseCatalogEntry[] = [
  // --- squat ---
  {
    id: "bodyweight_squat",
    displayName: "Bodyweight Squat",
    movementCategory: "squat",
    equipmentRequirements: [],
    supportedModalities: ["fixed_reps", "rep_range", "amrap"],
    substitutions: [],
    progressesTo: "goblet_squat",
  },
  {
    id: "goblet_squat",
    displayName: "Goblet Squat",
    movementCategory: "squat",
    equipmentRequirements: ["dumbbells"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    progressesTo: "barbell_back_squat",
    regressesTo: "bodyweight_squat",
  },
  {
    id: "barbell_back_squat",
    displayName: "Barbell Back Squat",
    movementCategory: "squat",
    equipmentRequirements: ["barbell", "squat_rack"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    regressesTo: "goblet_squat",
  },

  // --- hinge ---
  {
    id: "bodyweight_hip_hinge",
    displayName: "Bodyweight Hip Hinge",
    movementCategory: "hinge",
    equipmentRequirements: [],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    progressesTo: "dumbbell_romanian_deadlift",
  },
  {
    id: "dumbbell_romanian_deadlift",
    displayName: "Dumbbell Romanian Deadlift",
    movementCategory: "hinge",
    equipmentRequirements: ["dumbbells"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    progressesTo: "barbell_deadlift",
    regressesTo: "bodyweight_hip_hinge",
  },
  {
    id: "barbell_deadlift",
    displayName: "Barbell Deadlift",
    movementCategory: "hinge",
    equipmentRequirements: ["barbell"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    regressesTo: "dumbbell_romanian_deadlift",
  },

  // --- push ---
  {
    id: "pushup",
    displayName: "Push-Up",
    movementCategory: "push",
    equipmentRequirements: [],
    supportedModalities: ["fixed_reps", "rep_range", "amrap"],
    substitutions: [],
    progressesTo: "dumbbell_bench_press",
  },
  {
    id: "dumbbell_bench_press",
    displayName: "Dumbbell Bench Press",
    movementCategory: "push",
    equipmentRequirements: ["dumbbells", "bench"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: ["barbell_bench_press"],
    progressesTo: "barbell_bench_press",
    regressesTo: "pushup",
  },
  {
    id: "barbell_bench_press",
    displayName: "Barbell Bench Press",
    movementCategory: "push",
    equipmentRequirements: ["barbell", "bench"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: ["dumbbell_bench_press"],
    regressesTo: "dumbbell_bench_press",
  },

  // --- pull ---
  {
    id: "floor_ytw_raise",
    displayName: "Floor Y-T-W Raise",
    movementCategory: "pull",
    equipmentRequirements: [],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    progressesTo: "resistance_band_row",
  },
  {
    id: "resistance_band_row",
    displayName: "Resistance Band Row",
    movementCategory: "pull",
    equipmentRequirements: ["resistance_bands"],
    supportedModalities: ["fixed_reps", "rep_range", "time"],
    substitutions: [],
    progressesTo: "lat_pulldown",
    regressesTo: "floor_ytw_raise",
  },
  {
    id: "lat_pulldown",
    displayName: "Lat Pulldown",
    movementCategory: "pull",
    equipmentRequirements: ["cable_machine"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: ["pull_up"],
    progressesTo: "pull_up",
    regressesTo: "resistance_band_row",
  },
  {
    id: "pull_up",
    displayName: "Pull-Up",
    movementCategory: "pull",
    equipmentRequirements: ["pull_up_bar"],
    supportedModalities: ["fixed_reps", "rep_range", "amrap"],
    substitutions: ["lat_pulldown"],
    regressesTo: "lat_pulldown",
  },

  // --- carry ---
  {
    id: "bear_crawl",
    displayName: "Bear Crawl",
    movementCategory: "carry",
    equipmentRequirements: [],
    supportedModalities: ["time"],
    substitutions: [],
    progressesTo: "farmer_carry",
  },
  {
    id: "farmer_carry",
    displayName: "Farmer's Carry",
    movementCategory: "carry",
    equipmentRequirements: ["dumbbells"],
    supportedModalities: ["time"],
    substitutions: ["suitcase_carry"],
    regressesTo: "bear_crawl",
  },
  {
    id: "suitcase_carry",
    displayName: "Suitcase Carry (single-arm)",
    movementCategory: "carry",
    equipmentRequirements: ["dumbbells"],
    supportedModalities: ["time"],
    substitutions: ["farmer_carry"],
  },

  // --- core ---
  {
    id: "plank",
    displayName: "Plank",
    movementCategory: "core",
    equipmentRequirements: [],
    supportedModalities: ["time"],
    substitutions: [],
    progressesTo: "pallof_press",
  },
  {
    id: "pallof_press",
    displayName: "Pallof Press",
    movementCategory: "core",
    equipmentRequirements: ["resistance_bands"],
    supportedModalities: ["fixed_reps", "rep_range"],
    substitutions: [],
    regressesTo: "plank",
  },
  {
    id: "hanging_leg_raise",
    displayName: "Hanging Leg Raise",
    movementCategory: "core",
    equipmentRequirements: ["pull_up_bar"],
    supportedModalities: ["fixed_reps", "rep_range", "amrap"],
    substitutions: [],
    regressesTo: "plank",
  },

  // --- mobility ---
  {
    id: "hip_flexor_mobility",
    displayName: "Hip Flexor Mobility Flow",
    movementCategory: "mobility",
    equipmentRequirements: [],
    supportedModalities: ["time"],
    substitutions: [],
  },
  {
    id: "thoracic_rotation_mobility",
    displayName: "Thoracic Rotation Mobility Flow",
    movementCategory: "mobility",
    equipmentRequirements: [],
    supportedModalities: ["time"],
    substitutions: [],
  },
];

/** Raw entry list, preserved separately from the id-keyed record below so a duplicate id can actually be detected (a Record built from a duplicate-key list silently drops the earlier entry) — see validation/validateCatalog.ts. */
export const EXERCISE_CATALOG_ENTRIES: readonly ExerciseCatalogEntry[] = ENTRIES;

export const EXERCISE_CATALOG: Readonly<Record<string, ExerciseCatalogEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry]))
);
