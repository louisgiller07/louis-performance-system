/**
 * UX-11A.5b.4 — pure Force prescription builder (Session Model V2).
 *
 * Content only: no id, no UUID, no I/O, no date, no ordinal. Not wired into
 * any engine. It takes as few sport decisions as possible — every choice
 * comes from versioned content:
 * - template: THE template of (sessionKind, athleteTier) in
 *   strengthTemplateCatalogV2 (0 or several → contract error);
 * - work slots: first candidate of the template's ORDERED list that is
 *   allowed for the athlete's tier (cumulative V2 rule) and whose required
 *   equipment is all declared (optional equipment never blocks). Never the
 *   catalogue order, progressesTo, regressesTo or substitutions. None →
 *   `no_compatible_strength_exercise`;
 * - doses: strengthDoseCatalogV2 for (loadProfile, slot role): exact sets,
 *   RPE, rest; measure from the dose row (reps) or, for prevention, from
 *   the exercise's reference measure — never a unit conversion;
 * - warm-up: exactly the template's three items (sets from the template;
 *   measure, perSide, rest, cue, vigilances from the exercise catalogue),
 *   instructions from the strength_warm_up_v1 protocol;
 * - rampUp on the principal only: the protocol's main-movement-prep
 *   instruction, one to two sets, no load, no RPE, no id;
 * - intent: the unique selectable session-kind intent of the intent
 *   catalogue for this session kind.
 *
 * Composition depends only on (sessionKind, athleteTier, equipment,
 * template version): never on a date, an ordinal, a week or randomness.
 */
import type { StrengthExperienceTier } from "../../types/planInputSnapshot.js";
import { SESSION_EXERCISE_CATALOG_V2, type SessionExerciseRoleV2, type SessionExerciseV2 } from "../../catalog/sessionExerciseCatalogV2.js";
import { INTENT_CATALOG_V2_ENTRIES } from "../../catalog/intentCatalogV2.js";
import { PROTOCOL_CATALOG_V2 } from "../../catalog/protocolCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../catalog/coachingTextCatalog.js";
import {
  STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES,
  STRENGTH_TEMPLATE_SESSION_KINDS_V2,
  type StrengthTemplateSessionKindV2,
  type StrengthTemplateV2,
  type StrengthWarmUpItemV2,
  type StrengthWorkSlotV2,
} from "../../catalog/strengthTemplateCatalogV2.js";
import { STRENGTH_DOSE_CATALOG_V2, STRENGTH_LOAD_LEVELS_V2, type StrengthLoadLevelV2 } from "../../catalog/strengthDoseCatalogV2.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import type { BlockV2Content, ExerciseItemV2Content, ExerciseMeasureV2, PrescriptionV2Content } from "../prescriptionV2.js";
import { SessionModelV2ContractError, SessionModelV2GenerationBlockedError } from "../generationErrors.js";
import { isExerciseAllowedForTierV2, STRENGTH_TIER_ORDER_V2 } from "../strengthTiers.js";

export const STRENGTH_WARM_UP_PROTOCOL_ID = "strength_warm_up_v1";

export interface StrengthPrescriptionV2Input {
  sessionKind: StrengthTemplateSessionKindV2;
  athleteTier: StrengthExperienceTier;
  /** The snapshot's declared equipment. */
  equipment: readonly string[];
  /** LIGHT or MODERATE only (HEAVY is out of the V2 scope). */
  loadProfile: StrengthLoadLevelV2;
  catalog: SessionModelV2CatalogManifest;
}

/** Why a candidate was not selected (explains a no_compatible_strength_exercise block). */
export interface StrengthCandidateExamination {
  exerciseId: string;
  rejectedBecause: "tier" | "equipment";
  missingEquipment?: readonly string[];
}

export type StrengthSlotResolution = { ok: true; exercise: SessionExerciseV2 } | { ok: false; examined: readonly StrengthCandidateExamination[] };

function exerciseOrThrow(exerciseId: string): SessionExerciseV2 {
  const exercise = SESSION_EXERCISE_CATALOG_V2[exerciseId];
  if (!exercise) throw new SessionModelV2ContractError(`unknown V2 exercise ${exerciseId}`);
  return exercise;
}

/** First candidate of the slot's ordered list allowed for the tier with every required equipment declared. */
export function resolveStrengthSlotCandidate(slot: Pick<StrengthWorkSlotV2, "candidates">, athleteTier: StrengthExperienceTier, equipment: readonly string[]): StrengthSlotResolution {
  const examined: StrengthCandidateExamination[] = [];
  for (const exerciseId of slot.candidates) {
    const exercise = exerciseOrThrow(exerciseId);
    if (!isExerciseAllowedForTierV2(exercise, athleteTier)) {
      examined.push({ exerciseId, rejectedBecause: "tier" });
      continue;
    }
    const missing = exercise.requiredEquipment.filter((item) => !equipment.includes(item));
    if (missing.length > 0) {
      examined.push({ exerciseId, rejectedBecause: "equipment", missingEquipment: missing });
      continue;
    }
    return { ok: true, exercise };
  }
  return { ok: false, examined };
}

/** THE template of (sessionKind, athleteTier); anything else is a development error. */
export function strengthTemplateFor(sessionKind: StrengthTemplateSessionKindV2, athleteTier: StrengthExperienceTier): StrengthTemplateV2 {
  const matches = STRENGTH_TEMPLATE_CATALOG_V2_ENTRIES.filter((t) => t.sessionKind === sessionKind && t.athleteTier === athleteTier);
  if (matches.length !== 1) throw new SessionModelV2ContractError(`expected exactly one strength template for (${sessionKind}, ${athleteTier}), found ${matches.length}`);
  return matches[0]!;
}

/** The unique selectable session-kind intent of this strength session kind (intent catalogue rule, never the catalogue order). */
export function strengthIntentFor(sessionKind: StrengthTemplateSessionKindV2): string {
  const matches = INTENT_CATALOG_V2_ENTRIES.filter(
    (i) => i.family === "strength" && i.selectable && i.selection.type === "session_kind" && i.sessionKinds.includes(sessionKind)
  );
  if (matches.length !== 1) throw new SessionModelV2ContractError(`expected exactly one selectable session-kind intent for ${sessionKind}, found ${matches.length}`);
  return matches[0]!.intentId;
}

/** The exercise's own reference measure range (reps / duration / distance), never its sets, RPE or rest. */
function referenceMeasure(exercise: SessionExerciseV2): ExerciseMeasureV2 {
  const ref = exercise.referencePrescription;
  if (exercise.measureType === "reps" && ref.reps) return { type: "reps", min: ref.reps.min, max: ref.reps.max, perSide: exercise.perSide };
  if (exercise.measureType === "duration" && ref.durationSeconds) {
    return { type: "duration", minSeconds: ref.durationSeconds.min, maxSeconds: ref.durationSeconds.max, perSide: exercise.perSide };
  }
  if (exercise.measureType === "distance" && ref.distanceMeters) return { type: "distance", minMeters: ref.distanceMeters.min, maxMeters: ref.distanceMeters.max };
  throw new SessionModelV2ContractError(`exercise ${exercise.exerciseId} has no usable reference measure for ${exercise.measureType}`);
}

function warmUpItem(item: StrengthWarmUpItemV2, role: SessionExerciseRoleV2): ExerciseItemV2Content {
  const exercise = exerciseOrThrow(item.exerciseId);
  if (!exercise.roles.includes(role)) throw new SessionModelV2ContractError(`warm-up exercise ${exercise.exerciseId} does not hold role ${role}`);
  return {
    kind: "exercise",
    exerciseId: exercise.exerciseId,
    role,
    sets: item.sets,
    measure: referenceMeasure(exercise),
    restSeconds: { ...exercise.referencePrescription.restSeconds },
    cueId: exercise.cueId,
    vigilanceIds: [...exercise.vigilanceIds],
  };
}

function protocolInstructionId(focus: "mobility" | "activation" | "main_movement_prep"): string {
  const protocol = PROTOCOL_CATALOG_V2[STRENGTH_WARM_UP_PROTOCOL_ID];
  const block = protocol?.blocks.find((b) => b.focus === focus);
  const id = block?.instructionIds.length === 1 ? block.instructionIds[0] : undefined;
  if (!id || COACHING_TEXT_CATALOG[id]?.kind !== "instruction") {
    throw new SessionModelV2ContractError(`${STRENGTH_WARM_UP_PROTOCOL_ID} has no single canonical instruction for ${focus}`);
  }
  return id;
}

function protocolChoiceRole(focus: "mobility" | "activation"): SessionExerciseRoleV2 {
  const choice = PROTOCOL_CATALOG_V2[STRENGTH_WARM_UP_PROTOCOL_ID]?.blocks.find((b) => b.focus === focus)?.items.find((i) => i.kind === "exercise_choice");
  if (!choice || choice.kind !== "exercise_choice") throw new SessionModelV2ContractError(`${STRENGTH_WARM_UP_PROTOCOL_ID} has no ${focus} choice`);
  return choice.exerciseRole;
}

export function buildStrengthPrescriptionV2Content(input: StrengthPrescriptionV2Input): PrescriptionV2Content {
  if (!(STRENGTH_TEMPLATE_SESSION_KINDS_V2 as readonly string[]).includes(input.sessionKind)) {
    throw new SessionModelV2ContractError(`the Force builder only builds ${STRENGTH_TEMPLATE_SESSION_KINDS_V2.join(" / ")}, got ${input.sessionKind}`);
  }
  if (!STRENGTH_TIER_ORDER_V2.includes(input.athleteTier)) throw new SessionModelV2ContractError(`unknown athlete tier ${input.athleteTier}`);
  if (!(STRENGTH_LOAD_LEVELS_V2 as readonly string[]).includes(input.loadProfile)) {
    throw new SessionModelV2ContractError(`the Force builder only accepts ${STRENGTH_LOAD_LEVELS_V2.join(" / ")}, got ${input.loadProfile}`);
  }
  const protocol = PROTOCOL_CATALOG_V2[STRENGTH_WARM_UP_PROTOCOL_ID];
  if (!protocol || !protocol.sessionKinds.includes(input.sessionKind)) {
    throw new SessionModelV2ContractError(`${STRENGTH_WARM_UP_PROTOCOL_ID} does not cover ${input.sessionKind}`);
  }

  const template = strengthTemplateFor(input.sessionKind, input.athleteTier);
  const intentId = strengthIntentFor(input.sessionKind);
  const doses = STRENGTH_DOSE_CATALOG_V2[input.loadProfile];
  const rampUpInstructionId = protocolInstructionId("main_movement_prep");

  const warmUp: BlockV2Content = {
    role: "warm_up",
    instructionIds: [protocolInstructionId("mobility"), protocolInstructionId("activation")],
    items: [
      ...template.warmUp.mobility.map((item) => warmUpItem(item, protocolChoiceRole("mobility"))),
      ...template.warmUp.activation.map((item) => warmUpItem(item, protocolChoiceRole("activation"))),
    ],
  };

  const workBlocks: BlockV2Content[] = template.workSlots.map((slot, index) => {
    const resolution = resolveStrengthSlotCandidate(slot, input.athleteTier, input.equipment);
    if (!resolution.ok) {
      throw new SessionModelV2GenerationBlockedError("no_compatible_strength_exercise", {
        sessionKind: input.sessionKind,
        athleteTier: input.athleteTier,
        slot: index,
        role: slot.role,
        equipment: [...input.equipment],
        examined: resolution.examined,
      });
    }
    const exercise = resolution.exercise;
    if (!exercise.roles.includes(slot.role)) throw new SessionModelV2ContractError(`${exercise.exerciseId} does not hold role ${slot.role}`);
    const dose = doses[slot.role];
    let measure: ExerciseMeasureV2;
    if (dose.volume.source === "exercise_reference") {
      measure = referenceMeasure(exercise);
    } else {
      if (exercise.measureType !== "reps") {
        throw new SessionModelV2ContractError(`${exercise.exerciseId} is measured in ${exercise.measureType}; the ${slot.role} dose defines reps only (no conversion)`);
      }
      measure = { type: "reps", min: dose.volume.reps.min, max: dose.volume.reps.max, perSide: exercise.perSide };
    }
    const item: ExerciseItemV2Content = {
      kind: "exercise",
      exerciseId: exercise.exerciseId,
      role: slot.role,
      sets: dose.sets,
      measure,
      restSeconds: { ...dose.restSeconds },
      rpeTarget: { ...dose.rpeTarget },
      cueId: exercise.cueId,
      vigilanceIds: [...exercise.vigilanceIds],
      ...(slot.role === "principal" ? { rampUp: { instructionId: rampUpInstructionId, sets: { min: 1 as const, max: 2 as const } } } : {}),
    };
    return { role: slot.blockRole, instructionIds: [], items: [item] };
  });

  return {
    schemaVersion: "v2",
    family: "strength",
    sessionKind: input.sessionKind,
    intentId,
    catalog: input.catalog,
    blocks: [warmUp, ...workBlocks],
  };
}
