/**
 * PlanInputSnapshot — the immutable fact-freeze a TrainingPlanVersion was
 * generated from (M0 §C, Planning Engine Input Contract). Deliberately a
 * plain, self-contained structural record — never a re-export of a live DB
 * row shape — so an old version stays interpretable independent of how the
 * source tables evolve later (same reasoning as `decision_outcomes.
 * input_snapshot` in the existing schema).
 *
 * Only fields with an identified consumer/rule per M0 §C are represented
 * here. Notably ABSENT, on purpose: mental profile, general support-staff
 * roster, endurance experience/training frequency — none had a Planning
 * Engine rule identified; see the decision log for the full rejection list.
 */
import type { SessionKind } from "./sharedVocabulary.js";

export type StrengthExperienceTier = "beginner" | "intermediate" | "advanced";

export interface PlanInputRace {
  eventName: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
  priority: "A_PLUS" | "A" | "B" | "C";
}

/** One usable window on one recurring day of the week — e.g. "Tuesday, 17:00-19:00". */
export interface PlanInputAvailabilityWindow {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, matches JS Date convention
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  label?: string;
}

/** A one-off override for a specific date — e.g. "unavailable 2026-10-03, travel." */
export interface PlanInputAvailabilityException {
  date: string; // ISO date
  available: boolean;
  note?: string;
}

/**
 * M0 Issue 4 — recurring availability is a REQUIRED precondition for
 * generation, never a permissive default. `windows` must contain at least
 * one entry for a snapshot to be valid (see validation/validatePlanInput.ts)
 * — "the athlete explicitly declared full availability" produces real
 * entries here; it is never represented by this field being absent/empty.
 */
export interface PlanInputAvailability {
  windows: PlanInputAvailabilityWindow[];
  exceptions: PlanInputAvailabilityException[];
}

export interface PlanInputTechnicalPriorities {
  strengths: string[];
  weaknesses: string[];
  priorityAreas: string[];
}

/** A date the athlete/coach has flagged as fully off-limits to the planner (M0 §C "coach-controlled sessions"). Still counted for recovery-spacing purposes even though no session may be generated on it. */
export interface PlanInputLockedDate {
  date: string; // ISO date
  reason?: string;
}

/**
 * Derived from `completed_sessions` history — NOT athlete-declared, no new
 * storage (M0 §C: "current exercises / recent loads" and "recent training
 * volume" are derived inputs, rejected as new Performance Setup fields).
 */
export interface PlanInputRecentHistory {
  recentSessionKinds: SessionKind[];
  recentMissedOrReplacedCount: number;
  trailingVolumeMinutes: number;
}

export interface PlanInputSnapshot {
  discipline: string;
  competitionLevel?: string;
  seasonObjective?: string;
  races: PlanInputRace[];
  availability: PlanInputAvailability;
  equipment: string[];
  terrainAccess: string[];
  strengthExperienceTier: StrengthExperienceTier;
  declaredLimitations: string[];
  technicalPriorities: PlanInputTechnicalPriorities;
  lockedDates: PlanInputLockedDate[];
  recentHistory: PlanInputRecentHistory;
}
