/**
 * strengthResolver — assembles a StrengthPrescription from PrescriptionRequest
 * by calling the already-built strength selectors (V0.4_132). V0.4_134.
 *
 * Never chooses a different exercise, never recomputes load, never reads
 * recentHistory, never touches kind beyond checking it belongs to the
 * strength kinds, never persists anything. Never calls
 * validatePrescriptionStructure — that belongs to the future entry point
 * (prescriptionEngine.ts), not this resolver.
 *
 * repScheme/restSeconds have no approved V1 source (V0.4_124 §1/§2,
 * V0.4_126 §3) except repScheme's amrap case, which needs no invented
 * number at all. Both throw PendingProductDecisionError — already defined
 * in ../errors.ts (V0.4_131), reused rather than duplicated as
 * "PendingPrescriptionDecisionError ou équivalent" per this ticket's own
 * wording, since errors.ts is outside this ticket's authorized scope.
 * restSeconds always throws today, so resolveStrength always throws today
 * — the intended, already-documented V0.4_126 conclusion, not a bug.
 *
 * resolveStrengthKnownFields exists separately from resolveStrength so the
 * fields that DO have a real source (movementCategory, exerciseId, sets,
 * intensity, and repScheme's amrap case) stay independently testable even
 * though restSeconds always blocks the full assembly today.
 */
import type { PrescriptionRequest } from "../index.js";
import type { StrengthPrescription, RepScheme, Intensity, ExerciseCatalogEntry, MovementCategory } from "planning-engine";
import { EXERCISE_CATALOG } from "planning-engine";
import { selectMovementCategory } from "./movementCategorySelection.js";
import { selectExercise } from "./exerciseSelection.js";
import { STRENGTH_KINDS } from "../constants.js";
import { UnsupportedPrescriptionKindError, PendingProductDecisionError } from "../errors.js";

/** Pure technical version stamp — never a coaching value, same convention as EXERCISE_CATALOG_VERSION. */
const PRESCRIPTION_SCHEMA_VERSION = "v1";

export interface ResolvedStrengthKnownFields {
  movementCategory: MovementCategory;
  exerciseId: string;
  sets: number;
  intensity: Intensity;
  repScheme: RepScheme;
}

export function resolveRepScheme(exercise: ExerciseCatalogEntry): RepScheme {
  if (exercise.supportedModalities.includes("amrap")) {
    return { type: "amrap" };
  }
  throw new PendingProductDecisionError(
    "repScheme",
    `exercise "${exercise.id}" does not support "amrap" — no other RepScheme variant (fixed/range/time) has an approved V1 numeric source (V0.4_125 §1)`
  );
}

function resolveRestSeconds(): number {
  throw new PendingProductDecisionError(
    "restSeconds",
    "no approved V1 source exists for rest duration (V0.4_125 §2, V0.4_126 §3) — every candidate value, including 0, encodes a real coaching claim"
  );
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
        restSeconds: resolveRestSeconds(),
      },
    ],
  };
}
