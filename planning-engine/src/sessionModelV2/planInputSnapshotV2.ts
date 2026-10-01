/**
 * UX-11A.5b.2 — PlanInputSnapshot V2, types only (ADR UX-11A.5b.0.1).
 *
 * Keeps every v1 field and adds the rider-declared DH technical tier,
 * nullable: a V2 plan without DH stays generatable; the DH precondition
 * applies only when a plan really contains a DH session (5b.3+).
 * `technicalPriorities.priorityAreas` (already frozen in order) stays the
 * single source of DH priorities — no duplicate field.
 *
 * The generation pipeline is unchanged: nothing builds this snapshot yet.
 */
import type { PlanInputSnapshot, StrengthExperienceTier } from "../types/planInputSnapshot.js";
import type { DhTechnicalTierV2 } from "../catalog/sessionDrillCatalogV2.js";

export interface PlanInputSnapshotV2 extends PlanInputSnapshot {
  dhTechnicalTier: DhTechnicalTierV2 | null;
}

/**
 * The only snapshot data the Session Model V2 is allowed to read to select
 * content. Strengths and weaknesses are deliberately absent: they never
 * select anything. Everything comes from the snapshot, never from a live
 * profile read.
 */
export interface SessionModelV2Input {
  dhTechnicalTier: DhTechnicalTierV2 | null;
  /** Declared DH priorities, in their declared order (copied from technicalPriorities.priorityAreas). */
  priorityAreas: readonly string[];
  terrainAccess: readonly string[];
  equipment: readonly string[];
  strengthExperienceTier: StrengthExperienceTier;
}

export function toSessionModelV2Input(snapshot: PlanInputSnapshotV2): SessionModelV2Input {
  return {
    dhTechnicalTier: snapshot.dhTechnicalTier,
    priorityAreas: [...snapshot.technicalPriorities.priorityAreas],
    terrainAccess: [...snapshot.terrainAccess],
    equipment: [...snapshot.equipment],
    strengthExperienceTier: snapshot.strengthExperienceTier,
  };
}
