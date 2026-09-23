import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TrainingPlanOverview } from "./TrainingPlanOverview";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";

vi.mock("../acceptTrainingPlan", () => ({ acceptTrainingPlan: vi.fn() }));

function review(overrides: Partial<TrainingPlanReview> = {}): TrainingPlanReview {
  return {
    version: {
      id: "version-1",
      horizonStartDate: "2026-10-19",
      horizonEndDate: "2026-11-01",
      generationTrigger: "initial",
      rationale: "Initial training plan generation.",
      relaxedConstraints: [],
      generatedAt: "2026-09-20T10:00:00Z",
    },
    lifecycleState: "draft",
    blocks: [
      {
        id: "block-1",
        sequenceNumber: 1,
        name: "Base Phase",
        mode: "IN_SEASON",
        primaryFocus: "base_building",
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
            rationale: "Standard development week.",
            doseSummary: {
              plannedStrengthSessionCount: 2,
              plannedDhTechnicalSessionCount: 1,
              plannedAerobicSessionCount: 1,
              plannedRestOrRecoveryDayCount: 3,
              totalPlannedMinutes: 240,
            },
            sessions: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderOverview(props: Partial<Parameters<typeof TrainingPlanOverview>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TrainingPlanOverview review={review()} hasActivePlan={false} onAccepted={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

describe("TrainingPlanOverview", () => {
  it("displays the plan period, week count, and global rationale", () => {
    renderOverview();

    expect(screen.getByText(/1 semaine/)).toBeInTheDocument();
    expect(screen.getByText("Initial training plan generation.")).toBeInTheDocument();
  });

  it("displays the lifecycle state and volume summary", () => {
    renderOverview();

    expect(screen.getByText("Plan prêt à être accepté")).toBeInTheDocument();
    expect(screen.getByText(/2 force/)).toBeInTheDocument();
    expect(screen.getByText("240 min au total")).toBeInTheDocument();
  });

  it("shows the Accept button for a draft, and a link to modify the configuration", () => {
    renderOverview();

    expect(screen.getByRole("button", { name: "Accepter ce plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modifier ma configuration" })).toHaveAttribute("href", "/performance-setup");
  });

  it("never shows an Accept button once the version is no longer a draft", () => {
    renderOverview({ review: review({ lifecycleState: "accepted" }) });

    expect(screen.queryByRole("button", { name: "Accepter ce plan" })).not.toBeInTheDocument();
    expect(screen.getByText("Plan actif")).toBeInTheDocument();
  });

  it("never renders any internal id, hash, or technical version string", () => {
    renderOverview();

    expect(screen.queryByText(/version-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/inputSnapshot/i)).not.toBeInTheDocument();
  });
});
