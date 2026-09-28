import { describe, expect, it } from "vitest";
import { findAthleteModifiedProgramDates } from "./athleteModifiedProgramDays";
import type { TrainingPlanReview, TrainingPlanReviewSession } from "./trainingPlanReviewTypes";

function session(id: string, date: string): TrainingPlanReviewSession {
  return { id, weekId: "week-1", date, kind: "STRENGTH_LOWER", loadProfile: "MODERATE", durationMin: 60, doseTarget: null, rationale: "", prescription: null };
}

function reviewWithSessionDates(dates: string[]): TrainingPlanReview {
  return {
    version: {
      id: "version-1",
      horizonStartDate: "2026-10-19",
      horizonEndDate: "2026-11-01",
      generationTrigger: "initial",
      rationale: "",
      relaxedConstraints: [],
      generatedAt: "2026-09-20T10:00:00Z",
    },
    lifecycleState: "accepted",
    blocks: [
      {
        id: "block-1",
        sequenceNumber: 1,
        name: "Block",
        mode: "IN_SEASON",
        primaryFocus: "",
        startDate: "2026-10-19",
        endDate: "2026-11-01",
        weeks: [
          {
            id: "week-1",
            blockId: "block-1",
            weekNumber: 1,
            startDate: "2026-10-19",
            endDate: "2026-10-25",
            weekType: "development",
            rationale: "",
            doseSummary: {
              plannedStrengthSessionCount: 0,
              plannedDhTechnicalSessionCount: 0,
              plannedAerobicSessionCount: 0,
              plannedRestOrRecoveryDayCount: 0,
              totalPlannedMinutes: 0,
            },
            sessions: dates.map((date, index) => session(`session-${index}`, date)),
          },
        ],
      },
    ],
  };
}

describe("findAthleteModifiedProgramDates", () => {
  it("returns the program session dates held as manual rows, sorted", () => {
    const review = reviewWithSessionDates(["2026-10-22", "2026-10-20", "2026-10-24"]);

    expect(findAthleteModifiedProgramDates(review, ["2026-10-24", "2026-10-20"])).toEqual(["2026-10-20", "2026-10-24"]);
  });

  it("never counts a manual row on a date where the program has no session (an addition, not a modification)", () => {
    const review = reviewWithSessionDates(["2026-10-20"]);

    expect(findAthleteModifiedProgramDates(review, ["2026-10-21"])).toEqual([]);
  });

  it("returns an empty list when the athlete has no manual row", () => {
    expect(findAthleteModifiedProgramDates(reviewWithSessionDates(["2026-10-20"]), [])).toEqual([]);
  });

  it("counts a date once even when the input repeats it", () => {
    expect(findAthleteModifiedProgramDates(reviewWithSessionDates(["2026-10-20"]), ["2026-10-20", "2026-10-20"])).toEqual(["2026-10-20"]);
  });
});
