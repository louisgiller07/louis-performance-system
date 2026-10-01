/**
 * UX-11A.5b.2 — Prescription V2 domain types (ADR UX-11A.5b.0.1 / 5b.2).
 *
 * Two layers:
 * - `…Content` types: the sport content produced by the (future) pure
 *   Session Model V2 builder, WITHOUT identity ids;
 * - identified types (`PrescriptionV2`, `BlockV2`, `…ItemV2`): the same
 *   content after an orchestrator assigned `blockId` / `prescriptionItemId`
 *   (assignPrescriptionIds.ts). The pure content layer never decides how
 *   ids are generated (random UUIDs at orchestration level).
 *
 * Locked rules encoded here:
 * - `sets` is an exact integer, coming from a content template — never a
 *   value picked inside a catalogue range;
 * - a measure may be a range; durations are seconds, distances meters;
 * - measure types are exactly the recorded-set vocabulary: reps, duration,
 *   distance, pass (UX-11B.2.3);
 * - a drill item has no item role (`kind = "drill"` + the `main` block carry
 *   it) and is identified by `drillId` in the domain — never stored as an
 *   `exerciseId` alias (UX-11A.5b.2.1);
 * - an endurance activity is NOT an item (UX-11A.5b.2.1): the rider chooses
 *   one modality for the whole session, carried at session level by
 *   `activitySelection`; endurance blocks may have no item at all;
 * - `rampUp` only on a strength principal exercise: instruction + one or
 *   two light sets, no load, no RPE, no id, never `derivedFromItemId`;
 * - no load in kg, %1RM, FTP, watts or heart-rate zone anywhere.
 *
 * Not generated, not persisted, not read by any engine yet.
 */
import type { RangeV2, SessionExerciseRoleV2 } from "../catalog/sessionExerciseCatalogV2.js";
import type { SessionFamilyV2 } from "../catalog/intentCatalogV2.js";
import type { SessionBlockRoleV2 } from "../catalog/sessionFrameV2.js";
import type { EnduranceActivityV2, ProtocolBlockFocusV2 } from "../catalog/protocolCatalogV2.js";
import type { SessionKind } from "../types/sharedVocabulary.js";
import type { SessionModelV2CatalogManifest } from "./catalogManifest.js";

export const PRESCRIPTION_V2_SCHEMA_VERSION = "v2";

export const PRESCRIPTION_V2_ITEM_KINDS = ["exercise", "drill"] as const;
export type PrescriptionV2ItemKind = (typeof PRESCRIPTION_V2_ITEM_KINDS)[number];

/** Same vocabulary as exercise_set_results.measure_type (UX-11B.2.3). */
export const PRESCRIPTION_V2_MEASURE_TYPES = ["reps", "duration", "distance", "pass"] as const;
export type PrescriptionV2MeasureType = (typeof PRESCRIPTION_V2_MEASURE_TYPES)[number];

export type ExerciseMeasureV2 =
  | { type: "reps"; min: number; max: number; perSide: boolean }
  | { type: "duration"; minSeconds: number; maxSeconds: number; perSide: boolean }
  | { type: "distance"; minMeters: number; maxMeters: number };

/** Number of passages of the DH technical drill (4–8 in the current DH V2 content). */
export interface PassMeasureV2 {
  type: "pass";
  count: number;
}

/** Preparation of the main movement: never its own item, never recorded set by set in UX-11C V1. */
export interface RampUpV2 {
  instructionId: string;
  sets: { min: 1; max: 2 };
}

export interface ExerciseItemV2Content {
  kind: "exercise";
  exerciseId: string;
  role: SessionExerciseRoleV2;
  /** Exact number of sets, from the content template. */
  sets: number;
  measure: ExerciseMeasureV2;
  restSeconds?: RangeV2;
  rpeTarget?: RangeV2;
  cueId: string;
  vigilanceIds: readonly string[];
  rampUp?: RampUpV2;
}

export interface DrillItemV2Content {
  kind: "drill";
  drillId: string;
  measure: PassMeasureV2;
  cueId: string;
  successCriterionId: string;
  vigilanceIds: readonly string[];
}

export type PrescriptionItemV2Content = ExerciseItemV2Content | DrillItemV2Content;

/**
 * Session-level modality choice of an endurance session (warm-up, main and
 * cool-down all use the one activity the rider picks). Only "restricted"
 * exists: the rider chooses among an explicit, non-empty list derived from
 * the protocol. A free choice is not part of the generatable contract
 * (OPEN); an empty list never means "free". The builder never picks the
 * activity itself.
 */
export interface ActivitySelectionV2 {
  mode: "restricted";
  activityIds: readonly EnduranceActivityV2[];
}

export interface BlockV2Content {
  role: SessionBlockRoleV2;
  focus?: ProtocolBlockFocusV2;
  durationMinutes?: RangeV2;
  rpeTarget?: RangeV2;
  talkTestId?: string;
  instructionIds: readonly string[];
  items: readonly PrescriptionItemV2Content[];
}

export interface PrescriptionV2Content {
  schemaVersion: typeof PRESCRIPTION_V2_SCHEMA_VERSION;
  family: SessionFamilyV2;
  sessionKind: SessionKind;
  intentId: string;
  protocolId?: string;
  /** Endurance family only: the modality list the rider chooses from, once for the whole session. */
  activitySelection?: ActivitySelectionV2;
  catalog: SessionModelV2CatalogManifest;
  blocks: readonly BlockV2Content[];
}

/**
 * Identity of ONE occurrence of an item in ONE prescription — distinct from
 * the catalogue id (exerciseId / drillId).
 * `derivedFromItemId` is used ONLY on a daily final prescription
 * (UX-11A.5c): final item → planned item it derives from. Never on a
 * planned prescription, never for a rampUp.
 */
export interface PrescriptionItemIdentityV2 {
  prescriptionItemId: string;
  derivedFromItemId?: string;
}

export type ExerciseItemV2 = ExerciseItemV2Content & PrescriptionItemIdentityV2;
export type DrillItemV2 = DrillItemV2Content & PrescriptionItemIdentityV2;
export type PrescriptionItemV2 = ExerciseItemV2 | DrillItemV2;

export interface BlockV2 extends Omit<BlockV2Content, "items"> {
  blockId: string;
  items: readonly PrescriptionItemV2[];
}

export interface PrescriptionV2 extends Omit<PrescriptionV2Content, "blocks"> {
  blocks: readonly BlockV2[];
}
