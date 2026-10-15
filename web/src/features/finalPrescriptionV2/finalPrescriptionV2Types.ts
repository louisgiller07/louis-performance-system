// UX-11A.5c.4 — web contract of the daily final prescription V2 (read only).
// Separate from the V1 ExecutablePrescription contract (dailyPlanTypes.ts):
// a V2 document is never cast into V1 types and V1 is never parsed here.

export type FinalPrescriptionStatusV2 = "created" | "not_required" | "blocked";

export interface RangeView {
  min: number;
  max: number;
}

export type ExerciseMeasureView =
  | { type: "reps"; min: number; max: number; perSide: boolean }
  | { type: "duration"; minSeconds: number; maxSeconds: number; perSide: boolean }
  | { type: "distance"; minMeters: number; maxMeters: number };

/** PHYS-01 — the load a past session used (the rider's own recorded sets). */
export interface LoadReferenceView {
  sessionDate: string;
  loadKg: number;
  reps: number[];
  setsPrescribed: number | null;
  repsRange: RangeView | null;
  rpeMax: number | null;
}

/** PHYS-01 — the load to use today for a work exercise, read by the engine from the rider's own history (never a 1RM). */
export type LoadGuidanceView =
  | { mode: "calibrate"; reason: "no_history" | "history_without_load"; repsInReserve: RangeView | null }
  | { mode: "reference"; reason: "different_dose" | "history_too_old"; reference: LoadReferenceView; repsInReserve: RangeView | null }
  | {
      mode: "target";
      reason: "top_of_range_reached" | "within_range" | "below_range" | "effort_too_high";
      change: "increase" | "keep" | "decrease";
      targetKg: number;
      stepKg: number;
      reference: LoadReferenceView;
    };

export interface ExerciseItemView {
  kind: "exercise";
  prescriptionItemId: string;
  exerciseId: string;
  name: string;
  role: string;
  sets: number;
  measure: ExerciseMeasureView;
  restSeconds?: RangeView;
  rpeTarget?: RangeView;
  cue: string;
  vigilances: string[];
  rampUp?: { instruction: string; sets: RangeView };
  /** PHYS-01 — present on a Force work exercise carrying an external load. */
  loadGuidance?: LoadGuidanceView;
}

export interface DrillItemView {
  kind: "drill";
  prescriptionItemId: string;
  drillId: string;
  name: string;
  passes: number;
  cue: string;
  successCriterion: string;
  vigilances: string[];
}

export interface BlockView {
  blockId: string;
  role: string;
  roleLabel: string;
  durationMinutes?: RangeView;
  rpeTarget?: RangeView;
  talkTest?: string;
  instructions: string[];
  items: (ExerciseItemView | DrillItemView)[];
}

/** A final prescription V2 fully decoded and resolved against the supported catalogue version. */
export interface FinalPrescriptionV2View {
  id: string;
  decisionId: string;
  aggregate: string;
  sessionKind: string;
  family: string;
  intent: string;
  templateId?: string;
  protocolId?: string;
  /** Endurance only: the activities the rider may choose from (labels). */
  activities?: string[];
  /** Endurance only (UX-11C.4): the same choice with the prescription's activity ids, in order. */
  activityOptions?: { id: string; label: string }[];
  blocks: BlockView[];
}

/**
 * What Today shows for a V2 daily decision. `final_prescription_missing`,
 * `unsupported_schema_or_catalog` and `invalid` are fail-closed states: no
 * partial rendering, no V1 fallback, no reconstruction from the plan.
 */
export type FinalPrescriptionV2State =
  | { kind: "created"; prescription: FinalPrescriptionV2View }
  | { kind: "not_required" }
  | { kind: "blocked"; code: string; detail: Readonly<Record<string, unknown>> | null }
  | { kind: "final_prescription_missing" }
  | { kind: "unsupported_schema_or_catalog"; reason: string }
  | { kind: "invalid"; reason: string };
