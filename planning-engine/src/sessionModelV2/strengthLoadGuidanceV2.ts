/**
 * PHYS-01 — Force load guidance (pure): what load the rider should use today
 * for one work exercise, read from the loads they actually recorded.
 *
 * Double progression (PROVISIONAL, STRENGTH_LOAD_GUIDANCE_POLICY_V2):
 * - no recorded load for this exercise → `calibrate`: no number, an effort
 *   target (repetitions in reserve derived from today's RPE target) and the
 *   instruction to record the load used;
 * - a reference (the latest completed session with a recorded load) older
 *   than the policy's age, or prescribed with another repetition range
 *   (another dose, e.g. today's lighter session) → `reference`: the last load
 *   is shown, never converted to today's dose;
 * - same repetition range, recent reference → `target`, at the reference's
 *   working load (the load of most of its done sets, the lighter on a tie):
 *     effort too high (RPE ≥ target max + margin) → one step down;
 *     a set below the range's minimum → one step down;
 *     every prescribed set done at the top of the range without exceeding
 *     the RPE target (or RPE not recorded) → one step up;
 *     otherwise → same load.
 *   One step at most, never below one step.
 *
 * Never a 1RM, a % of 1RM or a declared profile value. Deterministic: same
 * history and date → same guidance. A non-loadable exercise (bodyweight,
 * bands) or a non-repetition measure gets no guidance (null).
 */
import { SESSION_EXERCISE_CATALOG_V2, type RangeV2 } from "../catalog/sessionExerciseCatalogV2.js";
import { STRENGTH_LOAD_GUIDANCE_POLICY_V2, STRENGTH_LOAD_GUIDANCE_RULES_VERSION, STRENGTH_LOAD_STEPS_KG_V2 } from "../catalog/strengthLoadGuidancePolicyV2.js";
import type { ExerciseMeasureV2, PrescriptionV2 } from "./prescriptionV2.js";

/** One recorded set (active result: a correction replaces its original). */
export interface StrengthSetRecordV2 {
  setNumber: number;
  done: boolean;
  reps: number | null;
  loadKg: number | null;
  rpe: number | null;
}

/** One completed session of the exercise, with what was prescribed that day for it. */
export interface StrengthExerciseSessionRecordV2 {
  sessionDate: string;
  prescribed: { sets: number; reps: RangeV2; rpeTarget: RangeV2 | null } | null;
  sets: readonly StrengthSetRecordV2[];
}

export interface StrengthLoadReferenceV2 {
  sessionDate: string;
  /** The working load: the load of most of the done sets (the lighter on a tie). */
  loadKg: number;
  /** Repetitions of the done sets at the working load, in set order. */
  reps: readonly number[];
  setsPrescribed: number | null;
  repsRange: RangeV2 | null;
  /** Highest RPE recorded at the working load (null: none recorded). */
  rpeMax: number | null;
}

export const STRENGTH_LOAD_GUIDANCE_MODES = ["calibrate", "reference", "target"] as const;
export const STRENGTH_LOAD_GUIDANCE_REASONS = {
  calibrate: ["no_history", "history_without_load"],
  reference: ["different_dose", "history_too_old"],
  target: ["top_of_range_reached", "within_range", "below_range", "effort_too_high"],
} as const;

export type StrengthLoadGuidanceV2 =
  | { ruleVersion: string; mode: "calibrate"; reason: "no_history" | "history_without_load"; repsInReserve: RangeV2 | null }
  | { ruleVersion: string; mode: "reference"; reason: "different_dose" | "history_too_old"; reference: StrengthLoadReferenceV2; repsInReserve: RangeV2 | null }
  | {
      ruleVersion: string;
      mode: "target";
      reason: "top_of_range_reached" | "within_range" | "below_range" | "effort_too_high";
      change: "increase" | "keep" | "decrease";
      targetKg: number;
      stepKg: number;
      reference: StrengthLoadReferenceV2;
    };

export interface StrengthLoadGuidanceInputV2 {
  item: { exerciseId: string; sets: number; measure: ExerciseMeasureV2; rpeTarget?: RangeV2 };
  /** The decision date (ISO). Only sessions strictly before it are read. */
  today: string;
  history: readonly StrengthExerciseSessionRecordV2[];
}

/** The load step of an exercise (kg), null when it carries no external load. */
export function strengthLoadStepKgV2(exerciseId: string): number | null {
  const exercise = SESSION_EXERCISE_CATALOG_V2[exerciseId];
  if (!exercise) return null;
  return STRENGTH_LOAD_STEPS_KG_V2.find((s) => exercise.requiredEquipment.includes(s.equipment))?.stepKg ?? null;
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
const roundHalf = (kg: number) => Math.round(kg * 2) / 2;

/** Repetitions in reserve of an RPE target (RIR = 10 − RPE). */
function repsInReserve(rpe: RangeV2 | undefined): RangeV2 | null {
  return rpe ? { min: Math.max(0, 10 - rpe.max), max: Math.max(0, 10 - rpe.min) } : null;
}

const doneWithReps = (s: StrengthSetRecordV2) => s.done && s.reps !== null && s.reps > 0;
const loaded = (s: StrengthSetRecordV2) => doneWithReps(s) && s.loadKg !== null && s.loadKg > 0;

function workingLoad(sets: readonly StrengthSetRecordV2[]): number {
  const counts = new Map<number, number>();
  for (const s of sets.filter(loaded)) counts.set(s.loadKg!, (counts.get(s.loadKg!) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

export function strengthLoadGuidanceV2(input: StrengthLoadGuidanceInputV2): StrengthLoadGuidanceV2 | null {
  const { item, today } = input;
  const stepKg = strengthLoadStepKgV2(item.exerciseId);
  if (stepKg === null || item.measure.type !== "reps") return null;
  const rir = repsInReserve(item.rpeTarget);
  const base = { ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION };

  const past = input.history.filter((s) => s.sessionDate < today).sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : a.sessionDate > b.sessionDate ? -1 : 0));
  const withLoad = past.filter((s) => s.sets.some(loaded));
  if (withLoad.length === 0) {
    return { ...base, mode: "calibrate", reason: past.some((s) => s.sets.some(doneWithReps)) ? "history_without_load" : "no_history", repsInReserve: rir };
  }

  const ref = withLoad[0]!;
  const load = workingLoad(ref.sets);
  const atLoad = ref.sets.filter((s) => loaded(s) && s.loadKg === load).sort((a, b) => a.setNumber - b.setNumber);
  const rpes = atLoad.map((s) => s.rpe).filter((r): r is number => r !== null);
  const reference: StrengthLoadReferenceV2 = {
    sessionDate: ref.sessionDate,
    loadKg: load,
    reps: atLoad.map((s) => s.reps!),
    setsPrescribed: ref.prescribed?.sets ?? null,
    repsRange: ref.prescribed ? { ...ref.prescribed.reps } : null,
    rpeMax: rpes.length > 0 ? Math.max(...rpes) : null,
  };

  if (dayNumber(today) - dayNumber(ref.sessionDate) > STRENGTH_LOAD_GUIDANCE_POLICY_V2.maxReferenceAgeDays) {
    return { ...base, mode: "reference", reason: "history_too_old", reference, repsInReserve: rir };
  }
  const range = item.measure;
  if (ref.prescribed === null || ref.prescribed.reps.min !== range.min || ref.prescribed.reps.max !== range.max) {
    return { ...base, mode: "reference", reason: "different_dose", reference, repsInReserve: rir };
  }

  const target = (change: "increase" | "keep" | "decrease", reason: "top_of_range_reached" | "within_range" | "below_range" | "effort_too_high") => {
    const next = change === "increase" ? load + stepKg : change === "decrease" ? load - stepKg : load;
    // Never below one step: a decrease that would reach 0 keeps the load.
    return next < stepKg
      ? { ...base, mode: "target" as const, reason, change: "keep" as const, targetKg: roundHalf(load), stepKg, reference }
      : { ...base, mode: "target" as const, reason, change, targetKg: roundHalf(next), stepKg, reference };
  };

  const rpeCeiling = item.rpeTarget?.max ?? null;
  if (reference.rpeMax !== null && rpeCeiling !== null && reference.rpeMax >= rpeCeiling + STRENGTH_LOAD_GUIDANCE_POLICY_V2.effortTooHighMargin) {
    return target("decrease", "effort_too_high");
  }
  if (atLoad.some((s) => s.reps! < range.min)) return target("decrease", "below_range");
  const everySet = atLoad.length >= ref.prescribed.sets;
  const topReached = atLoad.every((s) => s.reps! >= range.max);
  const effortOk = reference.rpeMax === null || rpeCeiling === null || reference.rpeMax <= rpeCeiling;
  if (everySet && topReached && effortOk) return target("increase", "top_of_range_reached");
  return target("keep", "within_range");
}

/** Work blocks: their exercise items take set results (same rule as the server and the web). */
const WORK_BLOCK_ROLES: readonly string[] = ["main", "complementary"];

/**
 * PHYS-01 — the final Force prescription with its load guidance: each work
 * exercise that carries an external load gets `loadGuidance` from its own
 * history (`historyByExercise`, keyed by exerciseId). Warm-up, cool-down and
 * non-loadable exercises are unchanged; a non-Force prescription is returned
 * as is. Pure: the caller reads the history and validates the result.
 */
export function attachStrengthLoadGuidanceV2<P extends PrescriptionV2>(structure: P, today: string, historyByExercise: Readonly<Record<string, readonly StrengthExerciseSessionRecordV2[]>>): P {
  if (structure.family !== "strength") return structure;
  return {
    ...structure,
    blocks: structure.blocks.map((block) =>
      !WORK_BLOCK_ROLES.includes(block.role)
        ? block
        : {
            ...block,
            items: block.items.map((item) => {
              if (item.kind !== "exercise") return item;
              const guidance = strengthLoadGuidanceV2({ item, today, history: historyByExercise[item.exerciseId] ?? [] });
              return guidance === null ? item : { ...item, loadGuidance: guidance };
            }),
          }
    ),
  };
}

/** PHYS-01 — the work exercises whose history the guidance needs (loadable, measured in repetitions). */
export function strengthLoadGuidanceExerciseIdsV2(structure: PrescriptionV2): string[] {
  if (structure.family !== "strength") return [];
  return structure.blocks
    .filter((b) => WORK_BLOCK_ROLES.includes(b.role))
    .flatMap((b) => b.items)
    .filter((i): i is Extract<typeof i, { kind: "exercise" }> => i.kind === "exercise" && i.measure.type === "reps" && strengthLoadStepKgV2(i.exerciseId) !== null)
    .map((i) => i.exerciseId);
}
