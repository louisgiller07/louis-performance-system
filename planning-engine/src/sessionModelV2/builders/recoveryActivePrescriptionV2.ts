/**
 * A04 — RECOVERY_ACTIVE V2 content, from the `recovery_active_v1` protocol
 * only (protocolCatalogV2): a very easy activity (main block, its protocol
 * duration range and RPE 2–3), light mobility and long-exhale breathing.
 * Every block of the protocol is kept, in order; each exercise takes its own
 * catalogue reference measure, rest, cue and vigilances (one set). No value
 * is invented here: the protocol's ranges ARE the prescription (the rider
 * picks within them).
 *
 * Used by the daily adaptation (REPLACE → RECOVERY_ACTIVE). Pure, ids
 * assigned by the caller.
 */
import { PROTOCOL_CATALOG_V2, type ProtocolBlockV2 } from "../../catalog/protocolCatalogV2.js";
import { SESSION_EXERCISE_CATALOG_V2, type SessionExerciseV2 } from "../../catalog/sessionExerciseCatalogV2.js";
import type { SessionModelV2CatalogManifest } from "../catalogManifest.js";
import { SessionModelV2ContractError } from "../generationErrors.js";
import type { BlockV2Content, ExerciseItemV2Content, ExerciseMeasureV2, PrescriptionV2Content } from "../prescriptionV2.js";

export const RECOVERY_ACTIVE_PROTOCOL_ID = "recovery_active_v1";

function referenceMeasure(exercise: SessionExerciseV2): ExerciseMeasureV2 {
  const ref = exercise.referencePrescription;
  if (exercise.measureType === "reps" && ref.reps) return { type: "reps", min: ref.reps.min, max: ref.reps.max, perSide: exercise.perSide };
  if (exercise.measureType === "duration" && ref.durationSeconds) {
    return { type: "duration", minSeconds: ref.durationSeconds.min, maxSeconds: ref.durationSeconds.max, perSide: exercise.perSide };
  }
  if (exercise.measureType === "distance" && ref.distanceMeters) return { type: "distance", minMeters: ref.distanceMeters.min, maxMeters: ref.distanceMeters.max };
  throw new SessionModelV2ContractError(`exercise ${exercise.exerciseId} has no usable reference measure for ${exercise.measureType}`);
}

function blockContent(block: ProtocolBlockV2): BlockV2Content {
  const items: ExerciseItemV2Content[] = block.items.map((item) => {
    if (item.kind !== "exercise") throw new SessionModelV2ContractError(`${RECOVERY_ACTIVE_PROTOCOL_ID} block ${block.role} holds a ${item.kind}, not an exercise`);
    const exercise = SESSION_EXERCISE_CATALOG_V2[item.exerciseId];
    if (!exercise) throw new SessionModelV2ContractError(`unknown exercise ${item.exerciseId} in ${RECOVERY_ACTIVE_PROTOCOL_ID}`);
    return {
      kind: "exercise",
      exerciseId: exercise.exerciseId,
      role: item.exerciseRole,
      sets: 1,
      measure: referenceMeasure(exercise),
      restSeconds: { ...exercise.referencePrescription.restSeconds },
      cueId: exercise.cueId,
      vigilanceIds: [...exercise.vigilanceIds],
    };
  });
  return {
    role: block.role,
    ...(block.focus !== undefined ? { focus: block.focus } : {}),
    ...(block.durationMinutes !== undefined ? { durationMinutes: { ...block.durationMinutes } } : {}),
    ...(block.targetRpe !== undefined ? { rpeTarget: { ...block.targetRpe } } : {}),
    instructionIds: [...block.instructionIds],
    items,
  };
}

export function buildRecoveryActivePrescriptionV2Content(input: { catalog: SessionModelV2CatalogManifest }): PrescriptionV2Content {
  const protocol = PROTOCOL_CATALOG_V2[RECOVERY_ACTIVE_PROTOCOL_ID];
  if (!protocol || protocol.family !== "recovery" || protocol.scope !== "session" || protocol.intentId === null || !protocol.sessionKinds.includes("RECOVERY_ACTIVE")) {
    throw new SessionModelV2ContractError(`${RECOVERY_ACTIVE_PROTOCOL_ID} is not a usable recovery session protocol`);
  }
  return {
    schemaVersion: "v2",
    family: "recovery",
    sessionKind: "RECOVERY_ACTIVE",
    intentId: protocol.intentId,
    protocolId: protocol.protocolId,
    catalog: input.catalog,
    blocks: protocol.blocks.map(blockContent),
  };
}
