// V06-02 — which days of a Training Plan the athlete has overridden in their
// own planning. Pure, no I/O: derived only from data that already exists
// (the plan's generated session dates + the dates of the athlete's manual
// planned_sessions rows), never stored anywhere.
import type { TrainingPlanReview } from "./trainingPlanReviewTypes";

/**
 * Program session dates that the athlete's planning holds as a manual row,
 * sorted ascending, deduplicated. A manual row on a date where the plan has
 * no session is an addition, not a modification — never counted. A program
 * day with no planned row at all is not counted either: it cannot be told
 * apart from a day the projection has simply not reached yet.
 */
export function findAthleteModifiedProgramDates(review: TrainingPlanReview, manualPlannedDates: readonly string[]): string[] {
  const manual = new Set(manualPlannedDates);
  const programDates = new Set(
    review.blocks.flatMap((block) => block.weeks.flatMap((week) => week.sessions.map((session) => session.date)))
  );
  return [...programDates].filter((date) => manual.has(date)).sort();
}
