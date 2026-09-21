/**
 * Pure, deterministic structural validation for PrescriptionStructure (M1
 * §7). Checks the domain discriminator, per-domain shape, catalogue-id
 * existence, and obvious numeric ranges. Deliberately does NOT reject a
 * `deprecated` catalogue entry — "is this id known at all" (including
 * deprecated ones, so an OLD prescription referencing a since-deprecated
 * exercise/drill is still valid/interpretable) is a different question from
 * "should a NEW generation be allowed to pick a deprecated id", which is a
 * Planning Engine policy decision, not this generic structural validator's
 * job.
 */
import { PlanningEngineValidationError } from "./errors.js";
import { EXERCISE_CATALOG } from "../catalog/exerciseCatalog.js";
import { DRILL_CATALOG } from "../catalog/drillCatalog.js";
import type { PrescriptionStructure } from "../types/prescriptionStructure.js";
import type { StrengthBlock, StrengthBlockRole, RepScheme, Intensity } from "../types/strengthPrescription.js";
import type { DhDrill } from "../types/dhPrescription.js";

const STRENGTH_BLOCK_ROLES: ReadonlySet<string> = new Set<StrengthBlockRole>(["warm_up", "work", "accessory"]);

function fail(reason: string, value: unknown): never {
  throw new PlanningEngineValidationError("PrescriptionStructure", reason, value);
}

function validateRepScheme(repScheme: RepScheme, block: unknown): void {
  switch (repScheme.type) {
    case "fixed":
      if (!(repScheme.reps > 0)) fail("repScheme.reps must be > 0", block);
      return;
    case "range":
      if (!(repScheme.min > 0) || !(repScheme.max >= repScheme.min)) {
        fail("repScheme.min must be > 0 and max must be >= min", block);
      }
      return;
    case "time":
      if (!(repScheme.seconds > 0)) fail("repScheme.seconds must be > 0", block);
      return;
    case "amrap":
      return;
    default:
      fail(`unknown repScheme.type "${(repScheme as { type: string }).type}"`, block);
  }
}

function validateIntensity(intensity: Intensity, block: unknown): void {
  switch (intensity.type) {
    case "rpe":
      if (!(intensity.target >= 0 && intensity.target <= 10)) fail("intensity.target (rpe) must be 0-10", block);
      return;
    case "rir":
      if (!(intensity.target >= 0)) fail("intensity.target (rir) must be >= 0", block);
      return;
    case "percent_1rm":
      if (!(intensity.value > 0)) fail("intensity.value (percent_1rm) must be > 0", block);
      return;
    case "fixed_load_kg":
      if (!(intensity.value > 0)) fail("intensity.value (fixed_load_kg) must be > 0", block);
      return;
    case "training_max_percent":
      if (!(intensity.value > 0)) fail("intensity.value (training_max_percent) must be > 0", block);
      return;
    case "bodyweight":
      return;
    default:
      fail(`unknown intensity.type "${(intensity as { type: string }).type}"`, block);
  }
}

function validateStrengthBlock(block: StrengthBlock): void {
  if (!STRENGTH_BLOCK_ROLES.has(block.role)) fail(`unknown role "${block.role}"`, block);
  if (!EXERCISE_CATALOG[block.exerciseId]) fail(`unknown exerciseId "${block.exerciseId}"`, block);
  if (!(block.sets > 0)) fail("sets must be > 0", block);
  if (!(block.restSeconds >= 0)) fail("restSeconds must be >= 0", block);
  validateRepScheme(block.repScheme, block);
  validateIntensity(block.intensity, block);
  if (block.substitutionOf !== undefined && !EXERCISE_CATALOG[block.substitutionOf]) {
    fail(`unknown substitutionOf "${block.substitutionOf}"`, block);
  }
}

function validateDhDrill(drill: DhDrill): void {
  if (!DRILL_CATALOG[drill.drillId]) fail(`unknown drillId "${drill.drillId}"`, drill);
  if (!(drill.runs > 0)) fail("runs must be > 0", drill);
  if (drill.skillTarget.trim().length === 0) fail("skillTarget must not be blank", drill);
  if (drill.terrainRequirement.trim().length === 0) fail("terrainRequirement must not be blank", drill);
  if (drill.executionCue.trim().length === 0) fail("executionCue must not be blank", drill);
  if (drill.successCriterion.trim().length === 0) fail("successCriterion must not be blank", drill);
}

/**
 * Validates a PrescriptionStructure. Throws {@link PlanningEngineValidationError}
 * on any mismatch — never coerces a malformed value into a plausible one.
 */
export function validatePrescriptionStructure(structure: PrescriptionStructure): void {
  if (structure.schemaVersion.trim().length === 0) fail("schemaVersion must not be blank", structure);

  switch (structure.domain) {
    case "strength":
      if (structure.blocks.length === 0) fail("strength prescription must have at least one block", structure);
      for (const block of structure.blocks) validateStrengthBlock(block);
      return;
    case "dh_technical":
      if (structure.drills.length === 0) fail("dh_technical prescription must have at least one drill", structure);
      for (const drill of structure.drills) validateDhDrill(drill);
      return;
    default:
      fail(`unknown domain "${(structure as { domain: string }).domain}"`, structure);
  }
}
