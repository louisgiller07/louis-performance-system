/**
 * dhResolver — assembles a DhTechnicalPrescription from PrescriptionRequest
 * by calling the already-built DH selectors (V0.4_133). V0.4_134.
 *
 * Never chooses a different skillTarget/drill, never recomputes load,
 * never reads recentHistory, never touches kind, never persists anything.
 * Never calls validatePrescriptionStructure — belongs to the future entry
 * point. Never produces RelaxedConstraint/insufficient_exercise_variety —
 * that collection belongs to a higher layer, not this resolver.
 *
 * executionCue has no approved V1 source (V0.4_126 §2 — DrillCatalogEntry
 * has no equivalent field, and no coaching cue text can be generated or
 * templated). Throws PendingProductDecisionError — already defined in
 * ../errors.ts (V0.4_131), reused rather than duplicated as
 * "PendingPrescriptionDecisionError ou équivalent" per this ticket's own
 * wording, since errors.ts is outside this ticket's authorized scope.
 *
 * resolveDhKnownFields exists separately from resolveDh so the fields that
 * DO have a real source (skillTarget, drillId, runs, successCriterion,
 * terrainRequirement) stay independently testable even though executionCue
 * always blocks the full assembly today — the intended, already-documented
 * V0.4_126 conclusion, not a bug.
 */
import type { PrescriptionRequest } from "../index.js";
import type { DhTechnicalPrescription, DhDrill } from "planning-engine";
import { DRILL_CATALOG } from "planning-engine";
import { selectSkillTarget } from "./skillTargetSelection.js";
import { selectDrill } from "./drillSelection.js";
import { UnsupportedPrescriptionKindError, PendingProductDecisionError } from "../errors.js";

/** Pure technical version stamp — never a coaching value, same convention as DRILL_CATALOG_VERSION. */
const PRESCRIPTION_SCHEMA_VERSION = "v1";

export interface ResolvedDhKnownFields {
  drillId: string;
  skillTarget: string;
  runs: number;
  successCriterion: string;
  terrainRequirement: string;
}

export function resolveDhKnownFields(request: PrescriptionRequest): ResolvedDhKnownFields {
  if (request.doseTarget.domain !== "dh_technical") {
    throw new UnsupportedPrescriptionKindError(request.kind);
  }

  const skillTarget = selectSkillTarget({
    technicalPriorities: request.technicalPriorities,
    terrainAccess: request.terrainAccess,
    strengthExperienceTier: request.strengthExperienceTier,
    generatedPlanSessionId: request.generatedPlanSessionId,
  });

  const drillId = selectDrill({
    skillTarget,
    terrainAccess: request.terrainAccess,
    strengthExperienceTier: request.strengthExperienceTier,
  });

  // Safe: selectDrill only ever returns a real DRILL_CATALOG id.
  const drill = DRILL_CATALOG[drillId]!;

  return {
    drillId,
    skillTarget,
    runs: request.doseTarget.focusedRunsCount,
    successCriterion: drill.successCriteria,
    terrainRequirement: drill.terrainRequirement,
  };
}

function resolveExecutionCue(drillId: string): string {
  throw new PendingProductDecisionError(
    "executionCue",
    `DrillCatalogEntry has no executionCue field for drill "${drillId}" — no coaching cue text can be generated or templated (V0.4_126 §2)`
  );
}

export function resolveDh(request: PrescriptionRequest): DhTechnicalPrescription {
  const known = resolveDhKnownFields(request);

  const drill: DhDrill = {
    drillId: known.drillId,
    skillTarget: known.skillTarget,
    terrainRequirement: known.terrainRequirement,
    runs: known.runs,
    successCriterion: known.successCriterion,
    executionCue: resolveExecutionCue(known.drillId),
  };

  return {
    domain: "dh_technical",
    schemaVersion: PRESCRIPTION_SCHEMA_VERSION,
    drills: [drill],
  };
}
