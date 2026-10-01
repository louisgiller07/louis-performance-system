/**
 * UX-11A.5a.4 — Strength doses V2: exact sets, rep / duration range, RPE and
 * rest per load level × work-slot role. The single source of V2 Force doses
 * (V2 never reads doseTarget.setVolume as sets or a set budget, nor
 * doseTarget.targetRpeOrRir as an RPE authority — those stay V1 inputs).
 *
 * Load levels: LIGHT and MODERATE only (the only levels the planner
 * produces). HEAVY is out of scope.
 *
 * Measure compatibility: `volume` is keyed by the exercise's own measure
 * type. A future builder uses `volume[exercise.measureType]`; a duration
 * exercise is never converted to reps (and vice versa). A missing key means
 * the dose is NOT defined for that measure type: the builder must refuse,
 * never invent. Reps of a per-side exercise are per side (catalogue
 * `perSide` semantics).
 *
 * Every value: PROVISIONAL — coaching validation required.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";
import type { RangeV2 } from "./sessionExerciseCatalogV2.js";
import type { StrengthWorkSlotRoleV2 } from "./strengthTemplateCatalogV2.js";

export const STRENGTH_DOSE_CATALOG_V2_VERSION = "strength-doses-v2.0";

export const STRENGTH_LOAD_LEVELS_V2 = ["LIGHT", "MODERATE"] as const;
export type StrengthLoadLevelV2 = (typeof STRENGTH_LOAD_LEVELS_V2)[number];

export interface StrengthRoleDoseV2 {
  /** Exact number of sets. */
  sets: number;
  /** Volume per set, keyed by the exercise's measure type; absent key = not defined (OPEN). */
  volume: { reps?: RangeV2; durationSeconds?: RangeV2 };
  rpeTarget: RangeV2;
  restSeconds: RangeV2;
  /** Content still missing for this row, kept visible (never filled by invention). */
  openQuestions: readonly string[];
  validationStatus: ContentValidationStatus;
}

const r = (min: number, max: number): RangeV2 => ({ min, max });

function dose(sets: number, volume: StrengthRoleDoseV2["volume"], rpe: RangeV2, rest: RangeV2, openQuestions: readonly string[] = []): StrengthRoleDoseV2 {
  return { sets, volume, rpeTarget: rpe, restSeconds: rest, openQuestions, validationStatus: "PROVISIONAL" };
}

const PREVENTION_VOLUME_OPEN = "strength_doses.prevention_volume_not_defined";

export const STRENGTH_DOSE_CATALOG_V2: Readonly<Record<StrengthLoadLevelV2, Readonly<Record<StrengthWorkSlotRoleV2, StrengthRoleDoseV2>>>> = {
  MODERATE: {
    principal: dose(4, { reps: r(6, 8) }, r(7, 8), r(120, 180)),
    secondary: dose(3, { reps: r(8, 12) }, r(7, 7), r(90, 90)),
    unilateral: dose(3, { reps: r(8, 10) }, r(7, 7), r(60, 90)),
    // Volume (reps or duration) for prevention / core was not provided: OPEN.
    prevention: dose(2, {}, r(6, 7), r(45, 60), [PREVENTION_VOLUME_OPEN]),
  },
  LIGHT: {
    principal: dose(3, { reps: r(8, 10) }, r(5, 6), r(90, 120)),
    secondary: dose(2, { reps: r(10, 12) }, r(5, 6), r(60, 90)),
    unilateral: dose(2, { reps: r(8, 10) }, r(5, 6), r(60, 60)),
    prevention: dose(2, {}, r(5, 6), r(45, 60), [PREVENTION_VOLUME_OPEN]),
  },
};
