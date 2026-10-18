/**
 * PHYS-04 — bodyweight repetitions guidance (pure, advisory): how many
 * repetitions to aim for today on one bodyweight work exercise (no required
 * equipment, measured in repetitions), read only from the repetitions and
 * efforts the rider actually recorded for THIS exercise. Never a load in kg,
 * never another exercise.
 *
 * Double progression on repetitions (PROVISIONAL, BODYWEIGHT_REPS_GUIDANCE_POLICY_V2):
 * - nothing recorded for this exercise → `calibrate`: the prescribed range,
 *   an effort target (repetitions in reserve), record repetitions and RPE;
 * - the TARGET reference is the latest completed session of this exercise
 *   prescribed with TODAY'S repetition range, no older than the policy's age;
 *   none → `reference`: the latest recorded repetitions are shown;
 * - `target`, from the reference's done sets:
 *     effort too high (RPE ≥ target max + margin) or a done set below the
 *     range → aim for the range's minimum (`decrease`);
 *     every prescribed set at the top of the range with the effort in target
 *     → keep the top (`keep`), and say what comes next: the catalogue has no
 *     harder variant without equipment (`no_bodyweight_variant`) or has one
 *     whose switch is not validated (`variant_not_validated`) — a harder
 *     variant is NEVER prescribed or suggested automatically;
 *     otherwise, the effort in target → one more repetition per set (the
 *     lowest done set + 1, never above the range), UNLESS today holds it
 *     (pain, M1 fatigue signal, or today's dose already heavier: one lever at
 *     a time) → `keep`; effort above target → `keep`.
 *
 * Deterministic: same history, date and today's state → same guidance.
 */
import { SESSION_EXERCISE_CATALOG_V2, type RangeV2 } from "../catalog/sessionExerciseCatalogV2.js";
import { BODYWEIGHT_REPS_GUIDANCE_POLICY_V2, BODYWEIGHT_REPS_GUIDANCE_RULES_VERSION } from "../catalog/bodyweightRepsGuidancePolicyV2.js";
import type { ExerciseMeasureV2, PrescriptionV2 } from "./prescriptionV2.js";
import type { StrengthExerciseSessionRecordV2, StrengthSetRecordV2 } from "./strengthLoadGuidanceV2.js";

export const REPS_GUIDANCE_KEY = "repsGuidance";

export interface BodyweightRepsReferenceV2 {
  sessionDate: string;
  /** Repetitions of the done sets, in set order. */
  reps: number[];
  setsPrescribed: number | null;
  repsRange: RangeV2 | null;
  rpeMax: number | null;
}

export type BodyweightRepsNextStepV2 = "no_bodyweight_variant" | "variant_not_validated";
export type BodyweightRepsHoldV2 = "dose_up" | "pain" | "fatigue";

export type BodyweightRepsGuidanceV2 =
  | { ruleVersion: string; mode: "calibrate"; reason: "no_history"; repsInReserve: RangeV2 | null }
  | { ruleVersion: string; mode: "reference"; reason: "different_dose" | "history_too_old"; reference: BodyweightRepsReferenceV2; repsInReserve: RangeV2 | null }
  | {
      ruleVersion: string;
      mode: "target";
      reason: "effort_too_high" | "below_range" | "within_range" | "top_of_range_reached";
      change: "increase" | "keep" | "decrease";
      targetReps: number;
      hold?: BodyweightRepsHoldV2;
      nextStep?: BodyweightRepsNextStepV2;
      reference: BodyweightRepsReferenceV2;
    };

/** A bodyweight work exercise: in the catalogue, needs no equipment, measured in repetitions. */
export function isBodyweightRepsExerciseV2(exerciseId: string): boolean {
  const e = SESSION_EXERCISE_CATALOG_V2[exerciseId];
  return e !== undefined && e.requiredEquipment.length === 0 && e.measureType === "reps";
}

/** What the catalogue offers after this exercise without equipment (never applied, only said). */
function nextStepOf(exerciseId: string): BodyweightRepsNextStepV2 {
  const next = SESSION_EXERCISE_CATALOG_V2[exerciseId]?.progressesTo;
  const variant = next !== undefined ? SESSION_EXERCISE_CATALOG_V2[next] : undefined;
  return variant !== undefined && variant.requiredEquipment.length === 0 ? "variant_not_validated" : "no_bodyweight_variant";
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
const doneWithReps = (s: StrengthSetRecordV2) => s.done && s.reps !== null && s.reps > 0;
const repsInReserve = (rpe: RangeV2 | undefined): RangeV2 | null => (rpe ? { min: Math.max(0, 10 - rpe.max), max: Math.max(0, 10 - rpe.min) } : null);

function referenceOf(session: StrengthExerciseSessionRecordV2): { reference: BodyweightRepsReferenceV2; done: StrengthSetRecordV2[] } {
  const done = session.sets.filter(doneWithReps).sort((a, b) => a.setNumber - b.setNumber);
  const rpes = done.map((s) => s.rpe).filter((r): r is number => r !== null);
  return {
    done,
    reference: {
      sessionDate: session.sessionDate,
      reps: done.map((s) => s.reps!),
      setsPrescribed: session.prescribed?.sets ?? null,
      repsRange: session.prescribed ? { ...session.prescribed.reps } : null,
      rpeMax: rpes.length > 0 ? Math.max(...rpes) : null,
    },
  };
}

export interface BodyweightRepsGuidanceInputV2 {
  item: { exerciseId: string; sets: number; measure: ExerciseMeasureV2; rpeTarget?: RangeV2 };
  today: string;
  history: readonly StrengthExerciseSessionRecordV2[];
  todayHold?: "pain" | "fatigue";
}

export function bodyweightRepsGuidanceV2(input: BodyweightRepsGuidanceInputV2): BodyweightRepsGuidanceV2 | null {
  const { item, today } = input;
  if (!isBodyweightRepsExerciseV2(item.exerciseId) || item.measure.type !== "reps") return null;
  const range = item.measure;
  const base = { ruleVersion: BODYWEIGHT_REPS_GUIDANCE_RULES_VERSION };
  const rir = repsInReserve(item.rpeTarget);
  const recent = (s: StrengthExerciseSessionRecordV2) => dayNumber(today) - dayNumber(s.sessionDate) <= BODYWEIGHT_REPS_GUIDANCE_POLICY_V2.maxReferenceAgeDays;

  const past = input.history
    .filter((s) => s.sessionDate < today && s.sets.some(doneWithReps))
    .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : a.sessionDate > b.sessionDate ? -1 : 0));
  if (past.length === 0) return { ...base, mode: "calibrate", reason: "no_history", repsInReserve: rir };

  const same = past.find((s) => recent(s) && s.prescribed !== null && s.prescribed.reps.min === range.min && s.prescribed.reps.max === range.max);
  if (same === undefined) {
    const latest = past[0]!;
    return { ...base, mode: "reference", reason: recent(latest) ? "different_dose" : "history_too_old", reference: referenceOf(latest).reference, repsInReserve: rir };
  }

  const { reference, done } = referenceOf(same);
  const target = (change: "increase" | "keep" | "decrease", reason: "effort_too_high" | "below_range" | "within_range" | "top_of_range_reached", targetReps: number, extra: { hold?: BodyweightRepsHoldV2; nextStep?: BodyweightRepsNextStepV2 } = {}) => ({
    ...base,
    mode: "target" as const,
    reason,
    change,
    targetReps,
    ...extra,
    reference,
  });

  const ceiling = item.rpeTarget?.max ?? null;
  if (reference.rpeMax !== null && ceiling !== null && reference.rpeMax >= ceiling + BODYWEIGHT_REPS_GUIDANCE_POLICY_V2.effortTooHighMargin) return target("decrease", "effort_too_high", range.min);
  if (done.some((s) => s.reps! < range.min)) return target("decrease", "below_range", range.min);

  const lowest = Math.min(...done.map((s) => s.reps!));
  const everySet = done.length >= same.prescribed!.sets;
  const effortOk = reference.rpeMax === null || ceiling === null || reference.rpeMax <= ceiling;
  if (everySet && lowest >= range.max && effortOk) return target("keep", "top_of_range_reached", range.max, { nextStep: nextStepOf(item.exerciseId) });
  if (!everySet || !effortOk) return target("keep", "within_range", Math.min(lowest, range.max));

  const refRpeMax = same.prescribed!.rpeTarget?.max ?? null;
  const doseUp = item.sets > same.prescribed!.sets || (ceiling !== null && refRpeMax !== null && ceiling > refRpeMax);
  if (input.todayHold !== undefined) return target("keep", "within_range", lowest, { hold: input.todayHold });
  if (doseUp) return target("keep", "within_range", lowest, { hold: "dose_up" });
  return target("increase", "within_range", Math.min(lowest + BODYWEIGHT_REPS_GUIDANCE_POLICY_V2.repsStep, range.max));
}

const WORK_BLOCK_ROLES: readonly string[] = ["main", "complementary"];

/** The final Force prescription with its bodyweight repetitions guidance (work exercises without equipment, in repetitions). */
export function attachBodyweightRepsGuidanceV2<P extends PrescriptionV2>(
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
              if (item.kind !== "exercise" || "loadGuidance" in item) return item;
              const guidance = bodyweightRepsGuidanceV2({ item, today, history: historyByExercise[item.exerciseId] ?? [], ...(todayHold !== undefined ? { todayHold } : {}) });
              return guidance === null ? item : { ...item, [REPS_GUIDANCE_KEY]: guidance };
            }),
          }
    ),
  };
}

/** The bodyweight work exercises whose history the guidance needs. */
export function bodyweightRepsGuidanceExerciseIdsV2(structure: PrescriptionV2): string[] {
  if (structure.family !== "strength") return [];
  return structure.blocks
    .filter((b) => WORK_BLOCK_ROLES.includes(b.role))
    .flatMap((b) => b.items)
    .filter((i) => i.kind === "exercise" && i.measure.type === "reps" && isBodyweightRepsExerciseV2(i.exerciseId))
    .map((i) => (i as { exerciseId: string }).exerciseId);
}
