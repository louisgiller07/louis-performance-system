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

/** PHYS-01.1 — dumbbells are counted per dumbbell; barbell, cable stack and kettlebell loads are the total moved. */
export type LoadBasisView = "per_dumbbell" | "total";

/** PHYS-01 — the load to use today for a work exercise, read by the engine from the rider's own history (never a 1RM). */
export type LoadGuidanceView =
  | { mode: "calibrate"; reason: "no_history" | "history_without_load"; loadBasis: LoadBasisView; repsInReserve: RangeView | null }
  | { mode: "reference"; reason: "different_dose" | "history_too_old"; loadBasis: LoadBasisView; reference: LoadReferenceView; repsInReserve: RangeView | null }
  | {
      mode: "target";
      reason: "top_of_range_reached" | "within_range" | "below_range" | "effort_too_high";
      change: "increase" | "keep" | "decrease";
      /** PHYS-01.1 — why an increase the history allowed is not applied today. */
      hold?: "dose_up" | "pain" | "fatigue";
      targetKg: number;
      stepKg: number;
      loadBasis: LoadBasisView;
      reference: LoadReferenceView;
    };

/** PHYS-04 — bodyweight repetitions guidance (advisory, from the rider's own recorded repetitions). */
export interface RepsReferenceView {
  sessionDate: string;
  reps: number[];
  rpeMax: number | null;
}
export type RepsGuidanceView =
  | { mode: "calibrate"; repsInReserve: RangeView | null }
  | { mode: "reference"; reason: "different_dose" | "history_too_old"; reference: RepsReferenceView }
  | {
      mode: "target";
      reason: "effort_too_high" | "below_range" | "within_range" | "top_of_range_reached";
      change: "increase" | "keep" | "decrease";
      targetReps: number;
      hold?: "dose_up" | "pain" | "fatigue";
      nextStep?: "no_bodyweight_variant" | "variant_not_validated";
      reference: RepsReferenceView;
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
  /** PHYS-04 — present on a Force work exercise without equipment, in repetitions. */
  repsGuidance?: RepsGuidanceView;
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

/** PHYS-02 — the rider's last recorded session of the same endurance protocol (advisory). */
export interface EnduranceGuidanceView {
  reference: { sessionDate: string; activityLabel: string; durationSeconds: number; distanceM: number | null; rpeActual: number | null };
  /** Base endurance only: the recorded RPE was above today's main-block target. */
  effortAboveTarget?: { rpeActual: number; rpeTargetMax: number };
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
  /** PHYS-02 — final endurance prescriptions only; absent when the engine gave none or it is unreadable. */
  enduranceGuidance?: EnduranceGuidanceView;
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
