import type { AvailabilityDayOfWeek, AvailabilityWindow, SaveAvailabilityWindowInput } from "../performanceSetup/availabilityRepo";
import type { RidingDay } from "../athleteOnboarding/onboardingOptions";
import type { PerformanceSetupAnswers } from "../performanceSetup/performanceSetupRepo";
import type { TrainingPlanReview, TrainingPlanReviewSession } from "../trainingPlanReview/trainingPlanReviewTypes";
import { planSessions } from "../program/programPresentation";
import { TIME_SLOTS } from "./firstRunPresentation";

// UX-09 — the "your training → your plan" half of the first run, as pure
// functions. Nothing here plans or scores: it prefills from what the rider
// already declared and turns one typical window into the availability
// windows the planner already reads (athlete_availability_windows).

export type SetupStep = "training" | "terrain" | "technique" | "strength" | "preparation" | "building" | "ready";

const RIDING_DAY_TO_DOW: Record<RidingDay, AvailabilityDayOfWeek> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Monday first, as everywhere in the app. */
export const WEEK_ORDER: readonly AvailabilityDayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

/** Training days: what is already saved, else prefilled with the riding days. */
export function initialTrainingDays(windows: readonly AvailabilityWindow[], ridingDays: readonly RidingDay[]): AvailabilityDayOfWeek[] {
  const days = windows.length > 0 ? windows.map((w) => w.dayOfWeek) : ridingDays.map((day) => RIDING_DAY_TO_DOW[day]);
  return WEEK_ORDER.filter((day) => days.includes(day));
}

export interface Slot {
  start: string;
  end: string;
}

/** The saved typical window when every saved window shares it; null otherwise (nothing guessed). */
export function initialSlot(windows: readonly AvailabilityWindow[]): Slot | null {
  if (windows.length === 0) return null;
  const { startTime, endTime } = windows[0]!;
  return windows.every((w) => w.startTime === startTime && w.endTime === endTime) ? { start: startTime, end: endTime } : null;
}

export function presetFor(slot: Slot | null): (typeof TIME_SLOTS)[number]["id"] | null {
  return TIME_SLOTS.find((preset) => slot && preset.start === slot.start && preset.end === slot.end)?.id ?? null;
}

export function isValidSlot(slot: Slot | null): slot is Slot {
  return slot !== null && /^\d{2}:\d{2}$/.test(slot.start) && /^\d{2}:\d{2}$/.test(slot.end) && slot.start < slot.end;
}

export function availabilityWindows(days: readonly AvailabilityDayOfWeek[], slot: Slot): SaveAvailabilityWindowInput[] {
  return days.map((dayOfWeek) => ({ dayOfWeek, startTime: slot.start, endTime: slot.end }));
}

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
