import type { AvailabilityWindow } from "../performanceSetup/availabilityRepo";
import type { PerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import type { TrainingPlanReview, TrainingPlanReviewSession } from "../trainingPlanReview/trainingPlanReviewTypes";
import { planSessions } from "../program/programPresentation";

// UX-09 — the "your training → your plan" half of the first run, as pure
// functions. Nothing here plans or scores. The availability week itself
// (physical / riding, BUG-V2-1) lives in ../availability/trainingAvailability.

export type SetupStep = "training" | "terrain" | "technique" | "strength" | "preparation" | "building" | "ready";

export interface SetupState {
  hasActivePlan: boolean;
  latestDraftId: string | null;
  windows: readonly AvailabilityWindow[];
  profile: PerformanceSetupAnswers;
}

/** Where the first run resumes: an existing first plan first, then the first missing answer. */
export function resumeStep(state: SetupState): SetupStep | "done" {
  if (state.hasActivePlan) return "done";
  if (state.latestDraftId) return "ready";
  if (state.windows.length === 0) return "training";
  if (state.profile.terrainAccess.length === 0) return "terrain";
  // UX-11A.5a.2b — a first run in progress asks the declared DH tier and the
  // ordered priorities. A completed first run (active plan / first plan
  // ready) never comes back here: legacy accounts are not forced.
  if (state.profile.dhTechnicalTier === null || state.profile.priorityAreas.length === 0) return "technique";
  if (state.profile.strengthExperienceTier === null) return "strength";
  return "preparation";
}

/** The next sessions of the plan from today (or its first sessions if it starts later). */
export function nextSessions(review: TrainingPlanReview, today: string, count = 3): TrainingPlanReviewSession[] {
  return planSessions(review)
    .filter((session) => session.date >= today)
    .slice(0, count);
}

export function planWeekCount(review: TrainingPlanReview): number {
  return review.blocks.reduce((total, block) => total + block.weeks.length, 0);
}
