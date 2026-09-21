/**
 * DhTechnicalPrescription — V1 typed structure for a DH technical session
 * (M0 §4). `drillId` references catalog/drillCatalog.ts. V0.4 is DH-focused
 * only — Enduro/Freeride are not modeled here (M1 constraint).
 */

export interface DhDrill {
  /** Catalogue id — see catalog/drillCatalog.ts. Never a display string. */
  drillId: string;
  /** Closed vocabulary, matches PlanInputTechnicalPriorities' vocabulary (planInputSnapshot.ts) so priorities can drive selection without a translation layer. */
  skillTarget: string;
  terrainRequirement: string;
  runs: number;
  executionCue: string;
  successCriterion: string;
  progressionCondition?: string;
  regressionCondition?: string;
}

export interface DhTechnicalPrescription {
  domain: "dh_technical";
  schemaVersion: string;
  drills: DhDrill[];
}
