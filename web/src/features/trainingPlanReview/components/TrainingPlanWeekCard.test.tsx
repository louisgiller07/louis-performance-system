import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainingPlanWeekCard } from "./TrainingPlanWeekCard";
import type { TrainingPlanReviewWeek } from "../trainingPlanReviewTypes";

const WEEK: TrainingPlanReviewWeek = {
  id: "week-1",
  blockId: "block-1",
  weekNumber: 1,
  startDate: "2026-10-19",
  endDate: "2026-10-25",
  weekType: "development",
  rationale: "Standard development week.",
  doseSummary: {
    plannedStrengthSessionCount: 2,
    plannedDhTechnicalSessionCount: 1,
    plannedAerobicSessionCount: 1,
    plannedRestOrRecoveryDayCount: 3,
    totalPlannedMinutes: 240,
  },
  sessions: [
    {
      id: "session-1",
      weekId: "week-1",
      date: "2026-10-20",
      kind: "STRENGTH_LOWER",
      loadProfile: "HEAVY",
      durationMin: 60,
      doseTarget: { domain: "strength" },
      rationale: "Standard development week. Adjusted due to recent missed or replaced sessions",
      prescription: null,
    },
    {
      id: "session-2",
      weekId: "week-1",
      date: "2026-10-21",
      kind: "AEROBIC_BASE",
      loadProfile: "MODERATE",
      durationMin: 90,
      doseTarget: { domain: "aerobic" },
      rationale: "Standard development week. Adjusted due to recent missed or replaced sessions",
      prescription: null,
    },
  ],
};

describe("TrainingPlanWeekCard", () => {
  it("displays the week number, type, rationale, and dose summary", () => {
    render(<TrainingPlanWeekCard week={WEEK} />);

    expect(screen.getByText(/Semaine 1/)).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("Standard development week.")).toBeInTheDocument();
    expect(screen.getByText(/2 force/)).toBeInTheDocument();
    expect(screen.getByText("240 min au total")).toBeInTheDocument();
  });

  it("renders every one of the week's sessions", () => {
    render(<TrainingPlanWeekCard week={WEEK} />);

    expect(screen.getByText("Strength Lower")).toBeInTheDocument();
    expect(screen.getByText("Aerobic Base")).toBeInTheDocument();
  });
});
