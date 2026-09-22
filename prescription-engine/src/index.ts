/**
 * prescription-engine — V0.4 scaffold (V0.4_131). Resolves a single
 * planning-engine session (kind + doseTarget) into a concrete
 * PrescriptionStructure by selecting exercises/drills from planning-engine's
 * catalogues. Sibling package to planning-engine and head-coach-engine —
 * consumes planning-engine's types, catalogues, and
 * validatePrescriptionStructure; never imports head-coach-engine internals
 * (see tests/unit/boundaries.test.ts).
 *
 * This file is a scaffold only — no resolver logic exists yet.
 * PrescriptionRequest/PrescriptionResult are the locked call contract
 * (V0.4_121/122, ownership locked V0.4_129 §1); the strength/DH resolvers
 * and the entry point that assembles a PrescriptionResult are out of scope
 * for this ticket.
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
export * from "./constants.js";
