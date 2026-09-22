/**
 * prescription-engine — V0.4 scaffold (V0.4_131). Resolves a single
 * planning-engine session (kind + doseTarget) into a concrete
 * PrescriptionStructure by selecting exercises/drills from planning-engine's
 * catalogues. Sibling package to planning-engine and head-coach-engine —
 * consumes planning-engine's types, catalogues, and
 * validatePrescriptionStructure; never imports head-coach-engine internals
 * (see tests/unit/boundaries.test.ts).
 *
 * PrescriptionRequest/PrescriptionResult are the locked call contract
 * (V0.4_121/122, ownership locked V0.4_129 §1). The strength/DH resolvers
 * (V0.4_132/133/134) and the prescriptionEngine entry point (V0.4_135) now
 * exist — this package can dispatch and validate end to end, though
 * repScheme (outside amrap), restSeconds, and executionCue still have no
 * approved V1 source and always throw PendingProductDecisionError.
 */
import type {
  SessionKind,
  LoadProfile,
  SessionDoseTarget,
  StrengthExperienceTier,
  PlanInputTechnicalPriorities,
  PlannedPrescription,
  RelaxedConstraint,
} from "planning-engine";

export { validatePrescriptionStructure } from "planning-engine";

export interface PrescriptionRequest {
  generatedPlanSessionId: string;
  /**
   * Id for the PlannedPrescription row this call will produce — assigned by
   * the caller (head-coach-engine, via randomUUID()) before invoking this
   * package, same precedent as generatedPlanSessionId (V0.4_114). Never
   * generated inside prescription-engine: doing so would break the pure,
   * deterministic "same input -> same output" contract every selector in
   * this package already relies on (V0.4_132/133). Found and locked V0.4_135.
   */
  plannedPrescriptionId: string;
  kind: SessionKind;

  durationMin: number;
  doseTarget: SessionDoseTarget;

  equipment: string[];
  technicalPriorities: PlanInputTechnicalPriorities;
  terrainAccess: string[];

  strengthExperienceTier: StrengthExperienceTier;

  loadProfile?: LoadProfile;
  date?: string;
}

export interface PrescriptionResult {
  prescription: PlannedPrescription;
  relaxedConstraints: RelaxedConstraint[];
}

export * from "./errors.js";
export { prescriptionEngine } from "./prescriptionEngine.js";
// STRENGTH_KINDS/DH_KINDS (./constants.js) are deliberately NOT re-exported
// here — an internal dispatch detail, never part of this package's public
// contract (V0.4_140 §1). Every internal consumer already imports them by
// direct relative path, never through this barrel.
