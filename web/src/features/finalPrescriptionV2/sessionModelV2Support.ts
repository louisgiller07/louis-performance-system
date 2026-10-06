// UX-11A.5c.4 — what this web build can render of the Session Model V2.
//
// Supported: the full catalogue manifest of the current engine version
// (`session-model-v2.6`) and of the versions it renders identically
// (`session-model-v2.5`: same exercises, drills, intents, protocols, texts
// and templates — BUG-V2-2 only changed which strength doses / plan dose
// policy a plan may choose, never the meaning of an id). A prescription
// written under any other manifest (older `v2.4`, a future `v2.7`, a changed
// component) is reported as unsupported: its ids are never resolved with the
// current tables, since the same id may mean something else in another
// version.
//
// Coaching texts (cues, instructions, success criteria, vigilances, intents)
// come only from the generated mirror of the engine catalogue
// (coachingTextsV1_0.generated.ts, coaching-text-v1.0). Exercise and drill
// names and the UI labels below are presentation only (same practice as
// trainingLabels/exerciseLabels.ts); a drift test keeps their id sets equal to
// the engine V2 catalogues.
import { COACHING_TEXTS_V1_0, type CoachingTextKindV1_0 } from "./coachingTextsV1_0.generated";
import { DRILL_LABELS, EXERCISE_LABELS } from "../trainingLabels/exerciseLabels";

/** The current engine manifest. */
export const SUPPORTED_SESSION_MODEL_V2_MANIFEST = {
  aggregate: "session-model-v2.6",
  exercises: "session-exercises-v2.1",
  drills: "session-drills-v2.0",
  intents: "session-intents-v2.0",
  protocols: "session-protocols-v2.0",
  texts: "coaching-text-v1.0",
  templates: "strength-templates-v2.1",
  strengthDoses: "strength-doses-v2.2",
  planDosePolicy: "plan-dose-policy-v2.4",
} as const;

export const SUPPORTED_SESSION_MODEL_V2_AGGREGATE = SUPPORTED_SESSION_MODEL_V2_MANIFEST.aggregate;

/** Every manifest this build renders: the current one first, then the earlier ones with the same id tables. */
export const SUPPORTED_SESSION_MODEL_V2_MANIFESTS: readonly Readonly<Record<string, string>>[] = [
  SUPPORTED_SESSION_MODEL_V2_MANIFEST,
  { ...SUPPORTED_SESSION_MODEL_V2_MANIFEST, aggregate: "session-model-v2.5", strengthDoses: "strength-doses-v2.1", planDosePolicy: "plan-dose-policy-v2.3" },
];

/** The text of `id` if it exists in the supported catalogue with the expected kind, else null (never a partial guess). */
export function resolveCoachingText(id: unknown, kind: CoachingTextKindV1_0): string | null {
  if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(COACHING_TEXTS_V1_0, id)) return null;
  const entry = COACHING_TEXTS_V1_0[id]!;
  return entry.kind === kind ? entry.text : null;
}

/**
 * French names of the V2 exercises not in the V1 catalogue (presentation
 * only, PROVISIONAL — product wording to validate). Every other V2 exercise
 * keeps its validated V1 label (REV-015.3).
 */
const EXERCISE_LABELS_V2_ONLY: Readonly<Record<string, string>> = {
  glute_bridge: "Pont fessier",
  barbell_romanian_deadlift: "Soulevé de terre roumain à la barre",
  dumbbell_hip_thrust: "Hip thrust aux haltères",
  reverse_lunge: "Fente arrière",
  step_up: "Montée sur banc",
  bulgarian_split_squat: "Squat bulgare",
  single_leg_romanian_deadlift: "Soulevé de terre roumain sur une jambe",
  single_leg_calf_raise: "Extension des mollets sur une jambe",
  copenhagen_plank_short: "Planche Copenhague courte",
  band_pull_apart: "Écartés à l'élastique",
  band_face_pull: "Tirage visage à l'élastique",
  inverted_row: "Tirage horizontal sous barre",
  one_arm_dumbbell_row: "Rowing un bras à l'haltère",
  half_kneeling_dumbbell_press: "Développé haltère à genou",
  dead_hang: "Suspension à la barre",
  side_plank: "Planche latérale",
  dead_bug: "Dead bug",
  bird_dog: "Bird dog",
  pogo_hops: "Sauts pogo",
  squat_jump: "Squat sauté",
  broad_jump: "Saut en longueur sans élan",
  skater_jump: "Sauts latéraux du patineur",
  dumbbell_swing: "Swing à l'haltère",
  plyo_pushup: "Pompes pliométriques",
  hip_90_90: "Mobilité de hanches 90/90",
  deep_squat_hold: "Squat profond tenu",
  knee_to_wall_ankle: "Genou au mur (cheville)",
  cat_cow: "Dos rond, dos creux",
  worlds_greatest_stretch: "World's greatest stretch",
  wrist_mobility: "Mobilité des poignets",
  breathing_long_exhale: "Respiration à expiration longue",
};

/** Every exercise id of session-exercises-v2.1. */
export const EXERCISE_IDS_V2_1: readonly string[] = [
  "bodyweight_squat", "goblet_squat", "barbell_back_squat", "bodyweight_hip_hinge", "glute_bridge", "dumbbell_romanian_deadlift",
  "barbell_romanian_deadlift", "barbell_deadlift", "dumbbell_hip_thrust", "reverse_lunge", "step_up", "bulgarian_split_squat",
  "single_leg_romanian_deadlift", "single_leg_calf_raise", "copenhagen_plank_short", "floor_ytw_raise", "band_pull_apart", "band_face_pull",
  "resistance_band_row", "inverted_row", "one_arm_dumbbell_row", "lat_pulldown", "pull_up", "pushup", "dumbbell_bench_press",
  "barbell_bench_press", "half_kneeling_dumbbell_press", "dead_hang", "farmer_carry", "suitcase_carry", "plank", "side_plank", "dead_bug",
  "bird_dog", "pallof_press", "hanging_leg_raise", "bear_crawl", "pogo_hops", "squat_jump", "broad_jump", "skater_jump", "dumbbell_swing",
  "plyo_pushup", "hip_flexor_mobility", "thoracic_rotation_mobility", "hip_90_90", "deep_squat_hold", "knee_to_wall_ankle", "cat_cow",
  "worlds_greatest_stretch", "wrist_mobility", "breathing_long_exhale",
];
const EXERCISE_ID_SET = new Set(EXERCISE_IDS_V2_1);

export function exerciseNameV2(exerciseId: unknown): string | null {
  if (typeof exerciseId !== "string" || !EXERCISE_ID_SET.has(exerciseId)) return null;
  return EXERCISE_LABELS_V2_ONLY[exerciseId] ?? EXERCISE_LABELS[exerciseId] ?? null;
}

/** session-drills-v2.0 uses the V1 drill ids, already labelled (REV-015.3). */
export function drillNameV2(drillId: unknown): string | null {
  return typeof drillId === "string" && Object.prototype.hasOwnProperty.call(DRILL_LABELS, drillId) ? DRILL_LABELS[drillId]! : null;
}

export const ENDURANCE_ACTIVITY_LABELS_V2: Readonly<Record<string, string>> = {
  road_bike: "Vélo de route",
  mtb_rolling: "VTT roulant",
  home_trainer: "Home-trainer",
  running: "Course à pied",
};

export const BLOCK_ROLE_LABELS_V2: Readonly<Record<string, string>> = {
  brief: "Brief",
  warm_up: "Échauffement",
  main: "Bloc principal",
  complementary: "Complémentaire",
  application: "Application terrain",
  cool_down: "Retour au calme",
};

export const SESSION_FAMILIES_V2 = ["strength", "power", "dh_technical", "endurance", "mobility", "recovery"] as const;
export const EXERCISE_ROLES_V2 = ["warm_up", "activation", "principal", "secondary", "unilateral", "prevention", "explosive", "mobility", "cool_down", "recovery"] as const;
