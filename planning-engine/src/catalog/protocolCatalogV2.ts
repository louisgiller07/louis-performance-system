/**
 * UX-11A.5a.3 — Session Model V2 protocol catalogue: endurance, mobility,
 * active recovery and the strength warm-up.
 *
 * A protocol is a validatable TEMPLATE, not a prescription:
 * - it never carries a prescriptionItemId (generated when a real v2
 *   prescription is built, UX-11A.5b);
 * - exercise items reference SESSION_EXERCISE_CATALOG_V2 by exerciseId; the
 *   dose of an exercise item is that exercise's referencePrescription (never
 *   repeated here);
 * - texts are ids of coachingTextCatalog.ts, never free text;
 * - no load in kg, no heart-rate zone, no % of FTP (03 §5); the target RPE is
 *   an independent target, never derived from a load level;
 * - an "exercise_choice" lists candidates and a count range: WHICH candidates
 *   are picked (equipment, session kind) is a future engine rule
 *   (UX-11A.5b), not decided here.
 *
 * The DH session is NOT a protocol: its frame lives in sessionFrameV2.ts
 * (UX-11A.5a.2a) and is never duplicated here.
 *
 * Not read by any engine yet (import boundary test). Own version.
 * Every entry: PROVISIONAL — coaching validation required. No dose is
 * validated by a strength & conditioning coach yet.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { IntentSessionKindV2, SessionFamilyV2 } from "./intentCatalogV2.js";
import type { RangeV2, SessionExerciseRoleV2 } from "./sessionExerciseCatalogV2.js";
import type { SessionBlockRoleV2 } from "./sessionFrameV2.js";

export const PROTOCOL_CATALOG_V2_VERSION = "session-protocols-v2.0";

/**
 * "session": a whole session of one family, with its intent.
 * "block_template": a reusable part of a session of another protocol or
 * generator (the strength warm-up), with no intent of its own.
 */
export const PROTOCOL_SCOPES_V2 = ["session", "block_template"] as const;
export type ProtocolScopeV2 = (typeof PROTOCOL_SCOPES_V2)[number];

/** Activities the rider may choose for an endurance session (03 §5 Endurance). */
export const ENDURANCE_ACTIVITIES_V2 = ["road_bike", "mtb_rolling", "home_trainer", "running"] as const;
export type EnduranceActivityV2 = (typeof ENDURANCE_ACTIVITIES_V2)[number];

/** What a block works on, when it matters: a mobility zone (MOBILITY_ZONES_V2), breathing, or a part of the strength warm-up. */
export const PROTOCOL_BLOCK_FOCUS_V2 = ["hips", "ankles", "spine", "wrists", "breathing", "mobility", "activation", "main_movement_prep"] as const;
export type ProtocolBlockFocusV2 = (typeof PROTOCOL_BLOCK_FOCUS_V2)[number];

/** A fixed exercise; its dose is its referencePrescription in the V2 exercise catalogue. */
export interface ProtocolExerciseItemV2 {
  kind: "exercise";
  exerciseId: string;
  /** The role the exercise plays here; must be one of the exercise's roles. */
  exerciseRole: SessionExerciseRoleV2;
}

/** Pick `count` exercises among `candidates` (the picking rule belongs to UX-11A.5b). */
export interface ProtocolExerciseChoiceItemV2 {
  kind: "exercise_choice";
  exerciseRole: SessionExerciseRoleV2;
  count: RangeV2;
  candidates: readonly string[];
}

/** A variant documented for later; never selected automatically. */
export interface IntervalVariantV2 {
  variantId: string;
  repetitions: number;
  autoSelectable: false;
}

/** Structured repeats: repetitions × work, with easy recovery between repetitions (not after the last). */
export interface ProtocolIntervalsItemV2 {
  kind: "intervals";
  repetitions: number;
  workSeconds: number;
  workRpe: RangeV2;
  easySeconds: number;
  variants: readonly IntervalVariantV2[];
}

export type ProtocolItemV2 = ProtocolExerciseItemV2 | ProtocolExerciseChoiceItemV2 | ProtocolIntervalsItemV2;

export interface ProtocolBlockV2 {
  role: SessionBlockRoleV2;
  focus?: ProtocolBlockFocusV2;
  /** Optional part of the family model (03 §3 table). */
  optional: boolean;
  /** Absent only for an untimed directive whose dose is still an open question. */
  durationMinutes?: RangeV2;
  targetRpe?: RangeV2;
  /** Talk test (instruction text id), endurance only; coexists with the RPE. */
  talkTestId?: string;
  instructionIds: readonly string[];
  items: readonly ProtocolItemV2[];
}

export interface SessionProtocolV2 {
  protocolId: string;
  scope: ProtocolScopeV2;
  family: SessionFamilyV2;
  /** Existing TrainingInterventionKind values this template is compatible with. */
  sessionKinds: readonly IntentSessionKindV2[];
  /** Existing intent (intentCatalogV2.ts); null for a block template. */
  intentId: string | null;
  totalDurationMinutes: RangeV2;
  /** Rider's choice of activity; [] when not applicable. */
  activityOptions: readonly EnduranceActivityV2[];
  blocks: readonly ProtocolBlockV2[];
  vigilanceIds: readonly string[];
  /** Sport questions explicitly left open (documented in the ADR), never decided by an engine. */
  openQuestions: readonly string[];
  validationStatus: ContentValidationStatus;
}

const r = (min: number, max: number): RangeV2 => ({ min, max });
const ex = (exerciseId: string, exerciseRole: SessionExerciseRoleV2): ProtocolExerciseItemV2 => ({ kind: "exercise", exerciseId, exerciseRole });

type ProtocolInput = Omit<SessionProtocolV2, "validationStatus" | "activityOptions" | "vigilanceIds" | "openQuestions"> &
  Partial<Pick<SessionProtocolV2, "activityOptions" | "vigilanceIds" | "openQuestions">>;

function protocol(input: ProtocolInput): SessionProtocolV2 {
  return { activityOptions: [], vigilanceIds: [], openQuestions: [], ...input, validationStatus: "PROVISIONAL" };
}

const ENTRIES: SessionProtocolV2[] = [
  // Endurance fondamentale (03: 45–90 min, RPE 3–4, talk test).
  protocol({
    protocolId: "endurance_base_continuous",
    scope: "session",
    family: "endurance",
    sessionKinds: ["AEROBIC_BASE"],
    intentId: "aerobic_base_lucidity",
    totalDurationMinutes: r(45, 90),
    activityOptions: ENDURANCE_ACTIVITIES_V2,
    blocks: [
      { role: "warm_up", optional: false, durationMinutes: r(10, 10), targetRpe: r(2, 3), instructionIds: ["instruction.endurance.activity_choice", "instruction.endurance.warm_up_easy"], items: [] },
      { role: "main", optional: false, durationMinutes: r(25, 75), targetRpe: r(3, 4), talkTestId: "instruction.endurance.talk_test_full_sentences", instructionIds: [], items: [] },
      { role: "cool_down", optional: false, durationMinutes: r(5, 5), targetRpe: r(2, 2), instructionIds: ["instruction.endurance.cool_down_easy"], items: [] },
    ],
    openQuestions: ["endurance_base.main_minimum_vs_total"],
  }),

  // Intervalles (03: échauffement, 6 × 3 min à RPE 8, 2 min faciles entre, retour au calme).
  protocol({
    protocolId: "endurance_intervals_3min",
    scope: "session",
    family: "endurance",
    sessionKinds: ["AEROBIC_INTERVALS"],
    intentId: "aerobic_repeat_efforts",
    totalDurationMinutes: r(53, 53),
    activityOptions: ENDURANCE_ACTIVITIES_V2,
    blocks: [
      { role: "warm_up", optional: false, durationMinutes: r(15, 15), instructionIds: ["instruction.endurance.activity_choice", "instruction.endurance.warm_up_easy"], items: [] },
      {
        role: "main",
        optional: false,
        durationMinutes: r(28, 28),
        instructionIds: ["instruction.endurance.intervals_work", "instruction.endurance.intervals_easy"],
        items: [{ kind: "intervals", repetitions: 6, workSeconds: 180, workRpe: r(8, 8), easySeconds: 120, variants: [{ variantId: "4x3min", repetitions: 4, autoSelectable: false }] }],
      },
      { role: "cool_down", optional: false, durationMinutes: r(10, 10), instructionIds: ["instruction.endurance.cool_down_easy"], items: [] },
    ],
    openQuestions: ["endurance_intervals.variant_4x3_selection", "endurance_intervals.warm_up_cool_down_rpe"],
  }),

  // Mobilité (03: routine par zones ciblées, chaque exercice en durée, terminée par de la respiration).
  protocol({
    protocolId: "mobility_routine_v1",
    scope: "session",
    family: "mobility",
    sessionKinds: ["MOBILITY"],
    intentId: "mobility_on_bike_range",
    totalDurationMinutes: r(25, 30),
    blocks: [
      { role: "main", focus: "hips", optional: false, durationMinutes: r(9, 11), instructionIds: ["instruction.mobility.slow_and_breathe"], items: [ex("hip_90_90", "mobility"), ex("hip_flexor_mobility", "mobility"), ex("deep_squat_hold", "mobility")] },
      { role: "main", focus: "ankles", optional: false, durationMinutes: r(3, 4), instructionIds: [], items: [ex("knee_to_wall_ankle", "mobility")] },
      { role: "main", focus: "spine", optional: false, durationMinutes: r(5, 7), instructionIds: [], items: [ex("cat_cow", "mobility"), ex("thoracic_rotation_mobility", "mobility")] },
      { role: "main", focus: "wrists", optional: false, durationMinutes: r(2, 3), instructionIds: [], items: [ex("wrist_mobility", "mobility")] },
      { role: "cool_down", focus: "breathing", optional: false, durationMinutes: r(3, 5), instructionIds: [], items: [ex("breathing_long_exhale", "cool_down")] },
    ],
    vigilanceIds: ["vigilance.mobility_no_forced_range"],
    openQuestions: ["mobility_routine.slow_calf_raise"],
  }),

  // Récupération active (03: objectif, durée, intensité faible ; mobilité et respiration en option).
  protocol({
    protocolId: "recovery_active_v1",
    scope: "session",
    family: "recovery",
    sessionKinds: ["RECOVERY_ACTIVE"],
    intentId: "recovery_without_fatigue",
    totalDurationMinutes: r(30, 55),
    blocks: [
      { role: "main", optional: false, durationMinutes: r(20, 40), targetRpe: r(2, 3), instructionIds: ["instruction.recovery.very_easy_activity"], items: [] },
      {
        role: "complementary",
        focus: "mobility",
        optional: true,
        durationMinutes: r(5, 10),
        instructionIds: ["instruction.recovery.light_mobility"],
        items: [ex("cat_cow", "recovery"), ex("hip_90_90", "recovery"), ex("thoracic_rotation_mobility", "recovery")],
      },
      { role: "cool_down", focus: "breathing", optional: true, durationMinutes: r(3, 5), instructionIds: [], items: [ex("breathing_long_exhale", "recovery")] },
    ],
    vigilanceIds: ["vigilance.mobility_no_forced_range"],
    openQuestions: ["recovery_active.activity_options"],
  }),

  // Échauffement renfo (block template of a Force session; no intent of its own).
  // The ramp-up sets of the main movement are NOT validated and the main
  // movement is unknown here: they stay an untimed canonical directive.
  protocol({
    protocolId: "strength_warm_up_v1",
    scope: "block_template",
    family: "strength",
    sessionKinds: ["STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_FULL_LIGHT", "GRIP_WORK"],
    intentId: null,
    totalDurationMinutes: r(6, 8),
    blocks: [
      {
        role: "warm_up",
        focus: "mobility",
        optional: false,
        durationMinutes: r(3, 4),
        instructionIds: ["instruction.strength_warm_up.mobility"],
        items: [
          {
            kind: "exercise_choice",
            exerciseRole: "warm_up",
            count: r(1, 2),
            candidates: ["hip_90_90", "worlds_greatest_stretch", "hip_flexor_mobility", "thoracic_rotation_mobility", "cat_cow", "knee_to_wall_ankle", "wrist_mobility"],
          },
        ],
      },
      {
        role: "warm_up",
        focus: "activation",
        optional: false,
        durationMinutes: r(3, 4),
        instructionIds: ["instruction.strength_warm_up.activation"],
        items: [{ kind: "exercise_choice", exerciseRole: "activation", count: r(1, 2), candidates: ["glute_bridge", "dead_bug", "bird_dog", "bear_crawl"] }],
      },
      { role: "warm_up", focus: "main_movement_prep", optional: false, instructionIds: ["instruction.strength_warm_up.main_movement_ramp"], items: [] },
    ],
    openQuestions: ["strength_warm_up.main_movement_ramp_sets", "strength_warm_up.candidates_by_session_kind", "strength_warm_up.exercise_count_vs_03"],
  }),
];

export const PROTOCOL_CATALOG_V2_ENTRIES: readonly SessionProtocolV2[] = ENTRIES;

export const PROTOCOL_CATALOG_V2: Readonly<Record<string, SessionProtocolV2>> = Object.fromEntries(ENTRIES.map((p) => [p.protocolId, p]));
