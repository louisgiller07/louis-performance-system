/**
 * dhResolver — assembles a DhTechnicalPrescription from PrescriptionRequest
 * by calling the already-built DH selectors (V0.4_133) and reading
 * prescription metadata directly from the catalogue (V0.4_138), which is
 * the sole source of truth for executionCue — never generated/templated
 * here.
 *
 * Never chooses a different skillTarget/drill, never recomputes load,
 * never reads recentHistory, never touches kind, never persists anything.
 * Never calls validatePrescriptionStructure — belongs to the entry point.
 * Never produces RelaxedConstraint/insufficient_exercise_variety — that
 * collection belongs to a higher layer, not this resolver.
 *
 * executionCue is read straight from the selected drill's catalogue entry
 * (V0.4_138 filled all 12 real entries). PendingProductDecisionError
 * (../errors.ts, V0.4_131) remains the guard for the case a catalogue
 * entry genuinely carries a blank executionCue — never a fabricated value.
 *
 * resolveDhKnownFields resolves every field a DhDrill needs (V0.4_139 —
 * previously split to work around executionCue always throwing, V0.4_134;
 * that reason no longer applies now that the catalogue carries real data,
 * so the split stays only as a clean, independently testable unit, not a
 * workaround).
 */
import type { PrescriptionRequest } from "../index.js";
import type { DhTechnicalPrescription, DhDrill, DrillCatalogEntry } from "planning-engine";
import { DRILL_CATALOG } from "planning-engine";
import { selectSkillTarget } from "./skillTargetSelection.js";
import { selectDrill } from "./drillSelection.js";
import { PRESCRIPTION_SCHEMA_VERSION } from "../constants.js";
import { UnsupportedPrescriptionKindError, PendingProductDecisionError } from "../errors.js";

export interface ResolvedDhKnownFields {
  drillId: string;
  skillTarget: string;
  runs: number;
  successCriterion: string;
  terrainRequirement: string;
  executionCue: string;
}

export function resolveExecutionCue(drill: DrillCatalogEntry): string {
  if (drill.executionCue.trim().length === 0) {
    throw new PendingProductDecisionError("executionCue", `drill "${drill.id}" has a blank executionCue in the catalogue`);
  }
  return drill.executionCue;
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
    executionCue: resolveExecutionCue(drill),
  };
}

export function resolveDh(request: PrescriptionRequest): DhTechnicalPrescription {
  const known = resolveDhKnownFields(request);

  const drill: DhDrill = {
    drillId: known.drillId,
    skillTarget: known.skillTarget,
    terrainRequirement: known.terrainRequirement,
    runs: known.runs,
    successCriterion: known.successCriterion,
    executionCue: known.executionCue,
  };

  return {
    domain: "dh_technical",
    schemaVersion: PRESCRIPTION_SCHEMA_VERSION,
    drills: [drill],
  };
}
