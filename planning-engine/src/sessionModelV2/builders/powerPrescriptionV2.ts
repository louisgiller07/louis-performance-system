/**
 * PHYS-03 — pure POWER (explosiveness) prescription builder (Session Model V2).
 *
 * Content only: no id, no I/O. Composes EXISTING catalogue content only
 * (POWER_SESSION_POLICY_V2, PROVISIONAL), in the session-model-v2.6 format:
 *
 * - warm-up (one `warm_up` block, progressive): the lower-body Force
 *   template's warm-up of the rider's tier (mobility, then activation, with
 *   the strength_warm_up_v1 instructions), then the plyometric activation
 *   `pogo_hops` (catalogue role activation, reference dose);
 * - explosive exercises (one `main` block each, in catalogue order): every
 *   exercise holding the role `explosive` the rider's tier and equipment
 *   allow, at most 4, at least 3 (docs/03 §5) — fewer → blocked, never a
 *   power session with an invented exercise. Each item carries the
 *   exercise's catalogue reference: reps, full rest (2–3 min), its technique
 *   cue and its vigilances (among them « arrête la série dès que la hauteur
 *   ou la vitesse baisse »). Sets: the minimum of the catalogue range (no
 *   automatic increase). No RPE (speed and quality, not effort), no load,
 *   no jump height;
 * - cool-down (one `cool_down` block): the lower-body Force cool-down
 *   (strengthDailyCatalogV2), with its instruction.
 *
 * A beginner has no explosive exercise at their tier (catalogue): no power
 * session. Callers check isPowerSessionPossibleV2 first (the planner never
 * places it, the daily path returns `no_compatible_power_exercise`); building
 * one anyway is a contract error.
 */
import { SESSION_EXERCISE_CATALOG_V2, type SessionExerciseV2 } from "../../catalog/sessionExerciseCatalogV2.js";
import { POWER_SESSION_POLICY_V2 } from "../../catalog/powerSessionPolicyV2.js";
import { STRENGTH_COOL_DOWN_INSTRUCTION_ID, STRENGTH_COOL_DOWN_V2 } from "../../catalog/strengthDailyCatalogV2.js";
import type { StrengthExperienceTier } from "../../types/planInputSnapshot.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import type { BlockV2Content, ExerciseItemV2Content, PrescriptionV2Content } from "../prescriptionV2.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import { isExerciseAllowedForTierV2 } from "../strengthTiers.js";
import { referenceMeasureV2, strengthTemplateWarmUpBlockV2 } from "./strengthPrescriptionV2.js";

export const POWER_SESSION_KIND_V2 = "POWER";
export const POWER_INTENT_ID_V2 = "corner_exit_power";

export interface PowerPrescriptionV2Input {
  athleteTier: StrengthExperienceTier;
  equipment: readonly string[];
  catalog: SessionModelV2CatalogManifest;
  /** A10 only (daily): keep the first N explosive exercises (never below the policy minimum). */
  workSlots?: number;
}

function exercise(exerciseId: string): SessionExerciseV2 {
  const e = SESSION_EXERCISE_CATALOG_V2[exerciseId];
  if (!e) throw new SessionModelV2ContractError(`unknown exercise ${exerciseId}`);
  return e;
}

function referenceItem(e: SessionExerciseV2, role: ExerciseItemV2Content["role"], sets: number): ExerciseItemV2Content {
  return {
    kind: "exercise",
    exerciseId: e.exerciseId,
    role,
    sets,
    measure: referenceMeasureV2(e),
    restSeconds: { ...e.referencePrescription.restSeconds },
    cueId: e.cueId,
    vigilanceIds: [...e.vigilanceIds],
  };
}

/** The explosive exercises a rider may do (tier, equipment), in catalogue order, at most the policy maximum. */
export function powerExplosiveExercisesV2(athleteTier: StrengthExperienceTier, equipment: readonly string[]): SessionExerciseV2[] {
  return Object.values(SESSION_EXERCISE_CATALOG_V2)
    .filter((e) => e.roles.includes("explosive") && isExerciseAllowedForTierV2(e, athleteTier) && e.requiredEquipment.every((item) => equipment.includes(item)))
    .slice(0, POWER_SESSION_POLICY_V2.explosiveExercises.max);
}

/** Whether a rider can have a power session at all (enough explosive exercises for their tier and equipment). */
export function isPowerSessionPossibleV2(athleteTier: StrengthExperienceTier, equipment: readonly string[]): boolean {
  return powerExplosiveExercisesV2(athleteTier, equipment).length >= POWER_SESSION_POLICY_V2.explosiveExercises.min;
}

export function buildPowerPrescriptionV2Content(input: PowerPrescriptionV2Input): PrescriptionV2Content {
  const explosive = powerExplosiveExercisesV2(input.athleteTier, input.equipment);
  const { min } = POWER_SESSION_POLICY_V2.explosiveExercises;
  if (explosive.length < min) {
    throw new SessionModelV2ContractError(`a power session needs ${min} explosive exercises, ${explosive.length} allowed for ${input.athleteTier} with [${input.equipment.join(", ")}]`);
  }
  if (input.workSlots !== undefined && (!Number.isInteger(input.workSlots) || input.workSlots < min || input.workSlots > explosive.length)) {
    throw new SessionModelV2ContractError(`power workSlots must be ${min} to ${explosive.length}, got ${input.workSlots}`);
  }

  const activation = exercise(POWER_SESSION_POLICY_V2.activationExerciseId);
  if (!activation.roles.includes("activation") || !isExerciseAllowedForTierV2(activation, input.athleteTier)) {
    throw new SessionModelV2ContractError(`${activation.exerciseId} is not an activation exercise for ${input.athleteTier}`);
  }
  const lowerWarmUp = strengthTemplateWarmUpBlockV2(POWER_SESSION_POLICY_V2.warmUpTemplateKind, input.athleteTier);
  const warmUp: BlockV2Content = { ...lowerWarmUp, items: [...lowerWarmUp.items, referenceItem(activation, "activation", activation.referencePrescription.sets.min)] };

  const work: BlockV2Content[] = explosive.slice(0, input.workSlots ?? explosive.length).map((e) => ({
    role: "main",
    instructionIds: [],
    items: [referenceItem(e, "explosive", e.referencePrescription.sets.min)],
  }));

  const coolDown: BlockV2Content = {
    role: "cool_down",
    instructionIds: [STRENGTH_COOL_DOWN_INSTRUCTION_ID],
    items: STRENGTH_COOL_DOWN_V2[POWER_SESSION_POLICY_V2.coolDownKind].map((c) => {
      const e = exercise(c.exerciseId);
      if (!e.roles.includes("cool_down")) throw new SessionModelV2ContractError(`${e.exerciseId} is not a cool-down exercise`);
      return referenceItem(e, "cool_down", c.sets);
    }),
  };

  return {
    schemaVersion: "v2",
    family: "power",
    sessionKind: POWER_SESSION_KIND_V2,
    intentId: POWER_INTENT_ID_V2,
    catalog: input.catalog,
    blocks: [warmUp, ...work, coolDown],
  };
}
