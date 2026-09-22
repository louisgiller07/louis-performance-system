/**
 * prescriptionEngine — the package's single entry point (V0.4_135).
 * Determines the domain via `kind` (using the already-existing
 * STRENGTH_KINDS/DH_KINDS partitions), delegates entirely to the matching
 * resolver — never re-deriving anything a resolver already owns: exercise/
 * drill choice, sets/runs, reading equipment/technicalPriorities/
 * recentHistory, or recomputing doseTarget. Calls
 * validatePrescriptionStructure exactly once, at this output boundary,
 * never inside a resolver (see strengthResolver.ts/dhResolver.ts, neither
 * calls it), on the bare PrescriptionStructure a resolver returns.
 *
 * PrescriptionResult.prescription is typed PlannedPrescription (locked
 * V0.4_121/122/129), a strictly richer envelope than the PrescriptionStructure
 * a resolver returns — {id, generatedPlanSessionId, schemaVersion,
 * catalogVersion, structure}. This entry point assembles that envelope:
 * `id` comes from PrescriptionRequest.plannedPrescriptionId (caller-assigned,
 * found and locked V0.4_135 — never generated here, that would break this
 * package's pure/deterministic contract); `catalogVersion` is derived
 * internally from the real EXERCISE_CATALOG_VERSION/DRILL_CATALOG_VERSION
 * constants depending on which domain resolved (never a parameter, same
 * precedent as V0.4_121's schemaVersion/catalogVersion reasoning).
 *
 * Errors are never caught or transformed here — UnsupportedPrescriptionKindError,
 * NoCompatibleExerciseError, NoCompatibleDrillError, PendingProductDecisionError,
 * and validatePrescriptionStructure's own PlanningEngineValidationError all
 * propagate to the caller unchanged.
 *
 * relaxedConstraints is always [] today — insufficient_exercise_variety,
 * placement_shortfall, and recovery_spacing all belong to other layers,
 * not this ticket (V0.4_124 §3, V0.4_126 §3).
 *
 * Both resolvers still throw PendingProductDecisionError for repScheme
 * (outside amrap), restSeconds, and executionCue (V0.4_134) — this entry
 * point does not resolve those blockers; it only closes the package's own
 * orchestration boundary.
 */
import type { PrescriptionRequest, PrescriptionResult } from "./index.js";
import type { PrescriptionStructure, PlannedPrescription } from "planning-engine";
import { validatePrescriptionStructure, EXERCISE_CATALOG_VERSION, DRILL_CATALOG_VERSION } from "planning-engine";
import { resolveStrength } from "./strength/strengthResolver.js";
import { resolveDh } from "./dh/dhResolver.js";
import { STRENGTH_KINDS, DH_KINDS } from "./constants.js";
import { UnsupportedPrescriptionKindError } from "./errors.js";

function catalogVersionFor(structure: PrescriptionStructure): string {
  return structure.domain === "strength" ? EXERCISE_CATALOG_VERSION : DRILL_CATALOG_VERSION;
}

export function prescriptionEngine(request: PrescriptionRequest): PrescriptionResult {
  let structure: PrescriptionStructure;

  if (STRENGTH_KINDS.has(request.kind)) {
    structure = resolveStrength(request);
  } else if (DH_KINDS.has(request.kind)) {
    structure = resolveDh(request);
  } else {
    throw new UnsupportedPrescriptionKindError(request.kind);
  }

  validatePrescriptionStructure(structure);

  const prescription: PlannedPrescription = {
    id: request.plannedPrescriptionId,
    generatedPlanSessionId: request.generatedPlanSessionId,
    schemaVersion: structure.schemaVersion,
    catalogVersion: catalogVersionFor(structure),
    structure,
  };

  return {
    prescription,
    relaxedConstraints: [],
  };
}
