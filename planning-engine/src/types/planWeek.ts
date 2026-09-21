/**
 * TrainingPlanWeek — persisted week structure within a TrainingPlanBlock
 * (M0 §7: persisted, not computed on the fly, so a superseded version's
 * week-level history stays fully inspectable later). Immutable, belongs to
 * its (immutable) plan version.
 */

export type WeekType = "development" | "deload" | "taper" | "race" | "recovery";

/**
 * A per-domain rollup, deliberately coarse (counts + minutes only) — M0 §D
 * dose model. No numeric coaching values (exact set/rep targets, exact
 * volume steps) are invented here; those are the planning algorithm's job
 * (M3+), not this contract's.
 */
export interface WeekDoseSummary {
  plannedStrengthSessionCount: number;
  plannedDhTechnicalSessionCount: number;
  plannedAerobicSessionCount: number;
  plannedRestOrRecoveryDayCount: number;
  totalPlannedMinutes: number;
}

export interface TrainingPlanWeek {
  id: string;
  blockId: string;
  /** 1-based, sequential within the block. */
  weekNumber: number;
  startDate: string; // ISO date
  endDate: string; // ISO date
  weekType: WeekType;
  doseSummary: WeekDoseSummary;
  rationale: string;
}
