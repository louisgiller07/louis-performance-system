/**
 * strengthResolver — assembles a StrengthPrescription from PrescriptionRequest
 * by calling the already-built strength selectors (V0.4_132) and reading
 * prescription metadata directly from the catalogue (V0.4_138), which is
 * the sole source of truth for repScheme/restSeconds — never invented here.
 *
 * Never chooses a different exercise, never recomputes load, never reads
 * recentHistory, never touches kind beyond checking it belongs to the
 * strength kinds, never persists anything. Never calls
 * validatePrescriptionStructure — that belongs to the entry point
 * (prescriptionEngine.ts), not this resolver.
 *
 * repScheme/restSeconds are read straight from the selected exercise's
 * catalogue entry (V0.4_138 filled all 21 real entries). PendingProductDecisionError
 * (../errors.ts, V0.4_131) remains the guard for the case a catalogue entry
 * genuinely lacks one of these fields — never a fabricated value.
 *
 * resolveStrengthKnownFields resolves every field a StrengthBlock needs
 * (V0.4_139 — previously split to work around repScheme/restSeconds always
 * throwing, V0.4_134; that reason no longer applies now that the catalogue
 * carries real data, so the split stays only as a clean, independently
 * testable unit, not a workaround).
 */
import type { PrescriptionRequest } from "../index.js";
import type { StrengthPrescription, RepScheme, Intensity, ExerciseCatalogEntry, MovementCategory } from "planning-engine";
import { EXERCISE_CATALOG } from "planning-engine";
import { selectMovementCategory } from "./movementCategorySelection.js";
import { selectExercise } from "./exerciseSelection.js";
import { STRENGTH_KINDS, PRESCRIPTION_SCHEMA_VERSION } from "../constants.js";
import { UnsupportedPrescriptionKindError, PendingProductDecisionError } from "../errors.js";

export interface ResolvedStrengthKnownFields {
  movementCategory: MovementCategory;
  exerciseId: string;
  sets: number;
  intensity: Intensity;
  repScheme: RepScheme;
  restSeconds: number;
}

export function resolveRepScheme(exercise: ExerciseCatalogEntry): RepScheme {
  if (exercise.repScheme === undefined) {
    throw new PendingProductDecisionError("repScheme", `exercise "${exercise.id}" has no repScheme defined in the catalogue`);
  }
  return exercise.repScheme;
}

export function resolveRestSeconds(exercise: ExerciseCatalogEntry): number {
  if (exercise.restSeconds === undefined) {
    throw new PendingProductDecisionError("restSeconds", `exercise "${exercise.id}" has no restSeconds defined in the catalogue`);
  }
  return exercise.restSeconds;
}

export function resolveStrengthKnownFields(request: PrescriptionRequest): ResolvedStrengthKnownFields {
  if (!STRENGTH_KINDS.has(request.kind)) {
    throw new UnsupportedPrescriptionKindError(request.kind);
  }
  if (request.doseTarget.domain !== "strength") {
    throw new UnsupportedPrescriptionKindError(request.kind);
  }

  const movementCategory = selectMovementCategory({ kind: request.kind, equipment: request.equipment });
  const exerciseId = selectExercise({
    movementCategory,
    equipment: request.equipment,
    strengthExperienceTier: request.strengthExperienceTier,
  });
  // Safe: selectExercise only ever returns a real EXERCISE_CATALOG id.
  const exercise = EXERCISE_CATALOG[exerciseId]!;

  return {
    movementCategory,
    exerciseId,
    sets: request.doseTarget.setVolume,
    intensity: { type: "rpe", target: request.doseTarget.targetRpeOrRir },
    repScheme: resolveRepScheme(exercise),
    restSeconds: resolveRestSeconds(exercise),
  };
}

export function resolveStrength(request: PrescriptionRequest): StrengthPrescription {
  const known = resolveStrengthKnownFields(request);

  return {
    domain: "strength",
    schemaVersion: PRESCRIPTION_SCHEMA_VERSION,
    blocks: [
      {
        role: "work",
        exerciseId: known.exerciseId,
        sets: known.sets,
        intensity: known.intensity,
        repScheme: known.repScheme,
        restSeconds: known.restSeconds,
      },
    ],
  };
}
