/**
 * UX-11A.5a.4 / 5a.4.1 — Strength doses V2: exact sets, RPE and rest per load
 * level × work-slot role, and an EXPLICIT source for the per-set measure.
 * The single source of V2 Force doses (V2 never reads doseTarget.setVolume as
 * sets or a set budget, nor doseTarget.targetRpeOrRir as an RPE authority —
 * those stay V1 inputs).
 *
 * Load levels: LIGHT and MODERATE only (the only levels the planner
 * produces). HEAVY is out of scope.
 *
 * Dose steps (BUG-V2-2, v2.2): the progression of a 6-week block uses one
 * more step, MODERATE_PLUS — an overload week at the same M1 load profile
 * (MODERATE: the daily engine sees the same load, KEEP stays valid) with one
 * more set on the principal and secondary slots and RPE 8. Volume OR
 * intensity, not a new exercise: same template, same exercises.
 *
 * Measure (`volume`):
 * - `{ source: "dose_catalog", reps }`: the rep range comes from this table;
 *   valid only for an exercise measured in reps (a duration exercise is
 *   never converted to reps — contract error);
 * - `{ source: "exercise_reference" }` (prevention / trunk): the measure
 *   range (reps OR duration, and perSide) comes from the selected
 *   exercise's referencePrescription — never its sets, RPE or rest, which
 *   stay in this table. No unit conversion.
 * Reps of a per-side exercise are per side (catalogue `perSide` semantics).
 *
 * Every value: PROVISIONAL — coaching validation required.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { RangeV2 } from "./sessionExerciseCatalogV2.js";
import type { StrengthWorkSlotRoleV2 } from "./strengthTemplateCatalogV2.js";

// v2.1 (UX-11A.5a.4.1): explicit `volume.source`; prevention measure from the exercise reference.
export const STRENGTH_DOSE_CATALOG_V2_VERSION = "strength-doses-v2.2";

export const STRENGTH_LOAD_LEVELS_V2 = ["LIGHT", "MODERATE"] as const;
export type StrengthLoadLevelV2 = (typeof STRENGTH_LOAD_LEVELS_V2)[number];

/** BUG-V2-2 — the dose steps of a block (lightest first); each maps to an M1 load profile. */
export const STRENGTH_DOSE_STEPS_V2 = ["LIGHT", "MODERATE", "MODERATE_PLUS"] as const;
export type StrengthDoseStepV2 = (typeof STRENGTH_DOSE_STEPS_V2)[number];
export const STRENGTH_DOSE_STEP_LOAD_V2: Readonly<Record<StrengthDoseStepV2, StrengthLoadLevelV2>> = { LIGHT: "LIGHT", MODERATE: "MODERATE", MODERATE_PLUS: "MODERATE" };

export type StrengthDoseVolumeV2 = { source: "dose_catalog"; reps: RangeV2 } | { source: "exercise_reference" };

export interface StrengthRoleDoseV2 {
  /** Exact number of sets. */
  sets: number;
  volume: StrengthDoseVolumeV2;
  rpeTarget: RangeV2;
  restSeconds: RangeV2;
  validationStatus: ContentValidationStatus;
}

const r = (min: number, max: number): RangeV2 => ({ min, max });

function dose(sets: number, volume: StrengthDoseVolumeV2, rpe: RangeV2, rest: RangeV2): StrengthRoleDoseV2 {
  return { sets, volume, rpeTarget: rpe, restSeconds: rest, validationStatus: "PROVISIONAL" };
}

const reps = (min: number, max: number): StrengthDoseVolumeV2 => ({ source: "dose_catalog", reps: r(min, max) });
const EXERCISE_REFERENCE: StrengthDoseVolumeV2 = { source: "exercise_reference" };

export const STRENGTH_DOSE_CATALOG_V2: Readonly<Record<StrengthDoseStepV2, Readonly<Record<StrengthWorkSlotRoleV2, StrengthRoleDoseV2>>>> = {
  // BUG-V2-2 — overload week: +1 set on principal / secondary, RPE 8 (same reps, exercises and slots).
  MODERATE_PLUS: {
    principal: dose(5, reps(6, 8), r(8, 8), r(150, 180)),
    secondary: dose(4, reps(8, 10), r(7, 8), r(90, 120)),
    unilateral: dose(3, reps(8, 10), r(7, 8), r(60, 90)),
    prevention: dose(2, EXERCISE_REFERENCE, r(6, 7), r(45, 60)),
  },
  MODERATE: {
    principal: dose(4, reps(6, 8), r(7, 8), r(120, 180)),
    secondary: dose(3, reps(8, 12), r(7, 7), r(90, 90)),
    unilateral: dose(3, reps(8, 10), r(7, 7), r(60, 90)),
    prevention: dose(2, EXERCISE_REFERENCE, r(6, 7), r(45, 60)),
  },
  LIGHT: {
    principal: dose(3, reps(8, 10), r(5, 6), r(90, 120)),
    secondary: dose(2, reps(10, 12), r(5, 6), r(60, 90)),
    unilateral: dose(2, reps(8, 10), r(5, 6), r(60, 60)),
    prevention: dose(2, EXERCISE_REFERENCE, r(5, 6), r(45, 60)),
  },
};
