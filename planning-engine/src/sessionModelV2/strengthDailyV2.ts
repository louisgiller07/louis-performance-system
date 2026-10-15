/**
 * PHYS-01.1 — the daily additions to a Force final prescription (pure).
 *
 * - `appendStrengthCoolDownV2`: every Force final prescription ends with the
 *   cool-down of strengthDailyCatalogV2 (full, or its mobility only when the
 *   session was shortened for the rider's time). The planned prescription is
 *   never changed: a plan stays exactly what the previous runtime writes.
 *   Idempotent: a structure that already has a cool_down block is returned
 *   as is. New ids for the block and its items (no lineage: they are not
 *   planned items).
 * - `shortenStrengthContentV2`: the rider's time today — the same session,
 *   same dose, same warm-up, keeping its first N work blocks (the principal
 *   always first). Never a shorter rest, never another exercise, never
 *   another dose.
 */
import { SESSION_EXERCISE_CATALOG_V2 } from "../catalog/sessionExerciseCatalogV2.js";
import { STRENGTH_COOL_DOWN_INSTRUCTION_ID, STRENGTH_COOL_DOWN_V2, STRENGTH_SHORTENED_V2 } from "../catalog/strengthDailyCatalogV2.js";
import { SessionModelV2ContractError } from "./generationErrors.js";
import type { BlockV2, ExerciseItemV2, ExerciseMeasureV2, PrescriptionV2, PrescriptionV2Content } from "./prescriptionV2.js";

export type StrengthCoolDownExtentV2 = "full" | "mobility";

function referenceMeasure(exerciseId: string): { measure: ExerciseMeasureV2; rest: { min: number; max: number }; cueId: string; vigilanceIds: readonly string[] } {
  const e = SESSION_EXERCISE_CATALOG_V2[exerciseId];
  if (!e || !e.roles.includes("cool_down")) throw new SessionModelV2ContractError(`${exerciseId} is not a cool-down exercise`);
  const ref = e.referencePrescription;
  const measure: ExerciseMeasureV2 =
    e.measureType === "duration" && ref.durationSeconds
      ? { type: "duration", minSeconds: ref.durationSeconds.min, maxSeconds: ref.durationSeconds.max, perSide: e.perSide }
      : e.measureType === "reps" && ref.reps
        ? { type: "reps", min: ref.reps.min, max: ref.reps.max, perSide: e.perSide }
        : (() => {
            throw new SessionModelV2ContractError(`${exerciseId} has no usable cool-down measure`);
          })();
  return { measure, rest: { ...ref.restSeconds }, cueId: e.cueId, vigilanceIds: [...e.vigilanceIds] };
}

export function appendStrengthCoolDownV2(structure: PrescriptionV2, mintId: () => string, extent: StrengthCoolDownExtentV2 = "full"): PrescriptionV2 {
  if (structure.family !== "strength" || structure.blocks.some((b) => b.role === "cool_down")) return structure;
  const plan = STRENGTH_COOL_DOWN_V2[structure.sessionKind as keyof typeof STRENGTH_COOL_DOWN_V2];
  if (!plan) return structure;
  const kept = extent === "mobility" ? plan.slice(0, STRENGTH_SHORTENED_V2.coolDownItems) : plan;
  const items: ExerciseItemV2[] = kept.map((c) => {
    const ref = referenceMeasure(c.exerciseId);
    return { kind: "exercise", prescriptionItemId: mintId(), exerciseId: c.exerciseId, role: "cool_down", sets: c.sets, measure: ref.measure, restSeconds: ref.rest, cueId: ref.cueId, vigilanceIds: ref.vigilanceIds };
  });
  const block: BlockV2 = { blockId: mintId(), role: "cool_down", instructionIds: [STRENGTH_COOL_DOWN_INSTRUCTION_ID], items };
  return { ...structure, blocks: [...structure.blocks, block] };
}

/** The same Force content keeping its first `workSlots` work blocks (main / complementary), everything else unchanged. */
export function shortenStrengthContentV2(content: PrescriptionV2Content, workSlots: number): PrescriptionV2Content {
  if (content.family !== "strength") throw new SessionModelV2ContractError(`only a Force session is shortened, got ${content.family}`);
  const work = content.blocks.filter((b) => b.role === "main" || b.role === "complementary");
  if (!Number.isInteger(workSlots) || workSlots < STRENGTH_SHORTENED_V2.minWorkSlots || workSlots > work.length) {
    throw new SessionModelV2ContractError(`workSlots must be ${STRENGTH_SHORTENED_V2.minWorkSlots} to ${work.length}, got ${workSlots}`);
  }
  const keep = new Set(work.slice(0, workSlots));
  return { ...content, blocks: content.blocks.filter((b) => (b.role !== "main" && b.role !== "complementary") || keep.has(b)) };
}
