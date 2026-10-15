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
  /**
   * BUG-V2-2 — V2 plans only (absent on V1 plans and on plans generated
   * before): the week's place in the block and its executable targets, so a
   * 6-week progression is readable and testable week by week. Transported
   * as-is in `training_plan_weeks.dose_summary` (jsonb, additive key).
   */
  progression?: WeekProgressionSummary;
}

/** BUG-V2-2 — role of a week in a V2 block (not a new week type: each role maps onto an existing WeekType). */
export type WeekProgressionRole = "introduction" | "build" | "build_plus" | "consolidation" | "race_specific" | "taper" | "race";

/** BUG-V2-2 — why the week has its role / its targets (closed list, never free text). */
export type WeekProgressionReasonCode =
  | "block_start_baseline"
  | "recent_training_history"
  | "post_race_reprise"
  | "cycle_progression"
  | "cycle_unload"
  | "race_in_week"
  | "race_in_next_week"
  | "race_in_two_weeks"
  | "recent_missed_sessions_hold"
  | "fixed_sessions_hold"
  | "beginner_strength_cap"
  | "adapted_to_availability"
  /** PHYS-02 — the week's endurance session is the intervals session (plans generated with the intervals option only). */
  | "endurance_intervals";

/** The week's executable targets (null = no session of that domain this week). */
export interface WeekProgressionTargets {
  forceDoseStep: "LIGHT" | "MODERATE" | "MODERATE_PLUS" | null;
  forceDurationMin: number | null;
  dhDurationMin: number | null;
  dhPasses: number | null;
  aerobicDurationMin: number | null;
  /** PHYS-02 — present only when the week's endurance session is the intervals session (absent = AEROBIC_BASE). */
  aerobicSessionKind?: "AEROBIC_INTERVALS";
}

export interface WeekProgressionSummary {
  /** The progression model that shaped the week (e.g. "plan-dose-policy-v2.4"). */
  model: string;
  role: WeekProgressionRole;
  /** 0-based build cycle of the block (a cycle = build, build+, consolidation). */
  cycle: number;
  reasonCodes: WeekProgressionReasonCode[];
  targets: WeekProgressionTargets;
  /** Sessions actually placed this week. */
  sessionCount: number;
  /** Strength + endurance minutes placed (physical preparation). */
  physicalMinutes: number;
  /** DH minutes placed (riding / terrain). */
  ridingMinutes: number;
  /** PHYS-02 — the intervals placement policy (e.g. "endurance-intervals-plan-v1"), present only on a week with the intervals session. */
  intervalsPolicy?: string;
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
