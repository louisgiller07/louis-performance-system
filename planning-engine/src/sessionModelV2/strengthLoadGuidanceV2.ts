/**
 * PHYS-01 / PHYS-01.1 — Force load guidance (pure): what load the rider should
 * use today for one work exercise, read only from the loads they actually
 * recorded for THIS exercise (same catalogue id: same movement, same
 * equipment). Another variant (another id, e.g. dumbbell vs barbell bench
 * press) is never compared: its load does not mean the same thing.
 *
 * Double progression (PROVISIONAL, STRENGTH_LOAD_GUIDANCE_POLICY_V2):
 * - no recorded load for this exercise → `calibrate`: no number, an effort
 *   target (repetitions in reserve derived from today's RPE target) and the
 *   instruction to record the load used;
 * - the TARGET reference is the latest completed session of this exercise
 *   prescribed with TODAY'S repetition range, no older than the policy's age.
 *   None → `reference`: the latest recorded load is shown (another dose, or
 *   too old), never converted to today's dose;
 * - `target`, at the reference's working load (the load of most of its done
 *   sets, the lighter on a tie):
 *     effort too high (RPE ≥ target max + margin) → one step down;
 *     a set below the range's minimum → one step down;
 *     every prescribed set done at the top of the range without exceeding
 *     the RPE target (or RPE not recorded) → one step up — UNLESS today holds
 *     it (`hold`): today's dose is already heavier than the reference's
 *     (more sets or a higher RPE target: one lever at a time), or today's
 *     check-in reports pain or M1 saw a fatigue signal. A held increase is
 *     "keep", with the reason it was held;
 *     otherwise → same load.
 *   One step at most, never below one step. A decrease is never held.
 *
 * `loadBasis`: dumbbells are recorded and advised per dumbbell; every other
 * load (barbell, cable stack, kettlebell) is the total moved.
 *
 * Never a 1RM, a % of 1RM or a declared profile value. Deterministic: same
 * history, date and today's state → same guidance. A non-loadable exercise
 * (bodyweight, bands) or a non-repetition measure gets no guidance (null).
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

export type StrengthLoadBasisV2 = "per_dumbbell" | "total";
/** Why an increase the history allows is not applied today. */
export type StrengthLoadHoldV2 = "dose_up" | "pain" | "fatigue";

export const STRENGTH_LOAD_GUIDANCE_MODES = ["calibrate", "reference", "target"] as const;
export const STRENGTH_LOAD_GUIDANCE_REASONS = {
  calibrate: ["no_history", "history_without_load"],
  reference: ["different_dose", "history_too_old"],
  target: ["top_of_range_reached", "within_range", "below_range", "effort_too_high"],
} as const;
export const STRENGTH_LOAD_HOLDS_V2: readonly StrengthLoadHoldV2[] = ["dose_up", "pain", "fatigue"];

export type StrengthLoadGuidanceV2 =
  | { ruleVersion: string; mode: "calibrate"; reason: "no_history" | "history_without_load"; loadBasis: StrengthLoadBasisV2; repsInReserve: RangeV2 | null }
  | { ruleVersion: string; mode: "reference"; reason: "different_dose" | "history_too_old"; loadBasis: StrengthLoadBasisV2; reference: StrengthLoadReferenceV2; repsInReserve: RangeV2 | null }
  | {
      ruleVersion: string;
      mode: "target";
      reason: "top_of_range_reached" | "within_range" | "below_range" | "effort_too_high";
      change: "increase" | "keep" | "decrease";
      /** Present only when the history allowed an increase that today does not apply. */
      hold?: StrengthLoadHoldV2;
      targetKg: number;
      stepKg: number;
      loadBasis: StrengthLoadBasisV2;
      reference: StrengthLoadReferenceV2;
    };

export interface StrengthLoadGuidanceInputV2 {
  item: { exerciseId: string; sets: number; measure: ExerciseMeasureV2; rpeTarget?: RangeV2 };
  /** The decision date (ISO). Only sessions strictly before it are read. */
  today: string;
  history: readonly StrengthExerciseSessionRecordV2[];
  /** Today's state that forbids an automatic increase (from the day's check-in and M1's signals); absent = none. */
  todayHold?: "pain" | "fatigue";
}

/** The load step of an exercise (kg) and how its load is counted; null when it carries no external load. */
export function strengthLoadStepV2(exerciseId: string): { stepKg: number; loadBasis: StrengthLoadBasisV2 } | null {
  const exercise = SESSION_EXERCISE_CATALOG_V2[exerciseId];
  if (!exercise) return null;
  const step = STRENGTH_LOAD_STEPS_KG_V2.find((s) => exercise.requiredEquipment.includes(s.equipment));
  return step ? { stepKg: step.stepKg, loadBasis: step.equipment === "dumbbells" ? "per_dumbbell" : "total" } : null;
}

/** The load step of an exercise (kg), null when it carries no external load. */
export function strengthLoadStepKgV2(exerciseId: string): number | null {
  return strengthLoadStepV2(exerciseId)?.stepKg ?? null;
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

function referenceOf(session: StrengthExerciseSessionRecordV2): { reference: StrengthLoadReferenceV2; atLoad: StrengthSetRecordV2[] } {
  const load = workingLoad(session.sets);
  const atLoad = session.sets.filter((s) => loaded(s) && s.loadKg === load).sort((a, b) => a.setNumber - b.setNumber);
  const rpes = atLoad.map((s) => s.rpe).filter((r): r is number => r !== null);
  return {
    atLoad,
    reference: {
      sessionDate: session.sessionDate,
      loadKg: load,
      reps: atLoad.map((s) => s.reps!),
      setsPrescribed: session.prescribed?.sets ?? null,
      repsRange: session.prescribed ? { ...session.prescribed.reps } : null,
      rpeMax: rpes.length > 0 ? Math.max(...rpes) : null,
    },
  };
}

export function strengthLoadGuidanceV2(input: StrengthLoadGuidanceInputV2): StrengthLoadGuidanceV2 | null {
  const { item, today } = input;
  const step = strengthLoadStepV2(item.exerciseId);
  if (step === null || item.measure.type !== "reps") return null;
  const { stepKg, loadBasis } = step;
  const range = item.measure;
  const rir = repsInReserve(item.rpeTarget);
  const base = { ruleVersion: STRENGTH_LOAD_GUIDANCE_RULES_VERSION };
  const recent = (s: StrengthExerciseSessionRecordV2) => dayNumber(today) - dayNumber(s.sessionDate) <= STRENGTH_LOAD_GUIDANCE_POLICY_V2.maxReferenceAgeDays;

  const past = input.history.filter((s) => s.sessionDate < today).sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : a.sessionDate > b.sessionDate ? -1 : 0));
  const withLoad = past.filter((s) => s.sets.some(loaded));
  if (withLoad.length === 0) {
    return { ...base, mode: "calibrate", reason: past.some((s) => s.sets.some(doneWithReps)) ? "history_without_load" : "no_history", loadBasis, repsInReserve: rir };
  }

  // The target reference: the latest recent session prescribed with today's repetition range.
  const same = withLoad.find((s) => recent(s) && s.prescribed !== null && s.prescribed.reps.min === range.min && s.prescribed.reps.max === range.max);
  if (same === undefined) {
    const latest = withLoad[0]!;
    return { ...base, mode: "reference", reason: recent(latest) ? "different_dose" : "history_too_old", loadBasis, reference: referenceOf(latest).reference, repsInReserve: rir };
  }

  const { reference, atLoad } = referenceOf(same);
  const load = reference.loadKg;
  const target = (change: "increase" | "keep" | "decrease", reason: "top_of_range_reached" | "within_range" | "below_range" | "effort_too_high", hold?: StrengthLoadHoldV2) => {
    const next = change === "increase" ? load + stepKg : change === "decrease" ? load - stepKg : load;
    // Never below one step: a decrease that would reach 0 keeps the load.
    const applied = next < stepKg ? "keep" : change;
    return {
      ...base,
      mode: "target" as const,
      reason,
      change: applied,
      ...(hold !== undefined ? { hold } : {}),
      targetKg: roundHalf(applied === change ? next : load),
      stepKg,
      loadBasis,
      reference,
    };
  };

  const rpeCeiling = item.rpeTarget?.max ?? null;
  if (reference.rpeMax !== null && rpeCeiling !== null && reference.rpeMax >= rpeCeiling + STRENGTH_LOAD_GUIDANCE_POLICY_V2.effortTooHighMargin) {
    return target("decrease", "effort_too_high");
  }
  if (atLoad.some((s) => s.reps! < range.min)) return target("decrease", "below_range");
  const everySet = atLoad.length >= same.prescribed!.sets;
  const topReached = atLoad.every((s) => s.reps! >= range.max);
  const effortOk = reference.rpeMax === null || rpeCeiling === null || reference.rpeMax <= rpeCeiling;
  if (everySet && topReached && effortOk) {
    // One lever at a time: today's dose already heavier than the reference's → the load waits.
    const refRpeMax = same.prescribed!.rpeTarget?.max ?? null;
    const doseUp = item.sets > same.prescribed!.sets || (rpeCeiling !== null && refRpeMax !== null && rpeCeiling > refRpeMax);
    if (input.todayHold !== undefined) return target("keep", "top_of_range_reached", input.todayHold);
    if (doseUp) return target("keep", "top_of_range_reached", "dose_up");
    return target("increase", "top_of_range_reached");
  }
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
export function attachStrengthLoadGuidanceV2<P extends PrescriptionV2>(
  structure: P,
  today: string,
  historyByExercise: Readonly<Record<string, readonly StrengthExerciseSessionRecordV2[]>>,
  todayHold?: "pain" | "fatigue"
): P {
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
              const guidance = strengthLoadGuidanceV2({ item, today, history: historyByExercise[item.exerciseId] ?? [], ...(todayHold !== undefined ? { todayHold } : {}) });
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
