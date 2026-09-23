import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainingPlanSessionCard } from "./TrainingPlanSessionCard";
import type { TrainingPlanReviewSession } from "../trainingPlanReviewTypes";

function session(overrides: Partial<TrainingPlanReviewSession> = {}): TrainingPlanReviewSession {
  return {
    id: "session-1",
    weekId: "week-1",
    date: "2026-10-20",
    kind: "STRENGTH_LOWER",
    loadProfile: "HEAVY",
    durationMin: 60,
    doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
    rationale: "Standard development week.",
    prescription: null,
    ...overrides,
  };
}

describe("TrainingPlanSessionCard", () => {
  it("displays the session's kind, duration, and rationale", () => {
    render(<TrainingPlanSessionCard session={session()} />);

    expect(screen.getByText("Strength Lower")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
    expect(screen.getByText("Standard development week.")).toBeInTheDocument();
  });

  it("renders nothing extra when prescription is null (e.g. an aerobic session)", () => {
    render(<TrainingPlanSessionCard session={session({ kind: "AEROBIC_BASE", doseTarget: { domain: "aerobic", intensityZone: "easy" }, prescription: null })} />);

    expect(screen.queryByText(/séries/)).not.toBeInTheDocument();
    expect(screen.queryByText(/passages/)).not.toBeInTheDocument();
  });

  it("displays the strength prescription's exercises when present", () => {
    render(
      <TrainingPlanSessionCard
        session={session({
          prescription: {
            id: "prescription-1",
            generatedPlanSessionId: "session-1",
            structure: { domain: "strength", schemaVersion: "v1", blocks: [{ role: "work", exerciseId: "bodyweight_squat", sets: 12 }] },
          },
        })}
      />
    );

    expect(screen.getByText("Bodyweight Squat")).toBeInTheDocument();
    expect(screen.getByText(/12 séries/)).toBeInTheDocument();
  });

  it("displays the DH prescription's drills when present", () => {
    render(
      <TrainingPlanSessionCard
        session={session({
          kind: "DH_TECHNICAL",
          doseTarget: { domain: "dh_technical", skillTargets: ["cornering"], focusedRunsCount: 6 },
          prescription: {
            id: "prescription-2",
            generatedPlanSessionId: "session-1",
            structure: {
              domain: "dh_technical",
              schemaVersion: "v1",
              drills: [{ drillId: "cornering_flat_turn_precision", skillTarget: "cornering", runs: 6, executionCue: "Look where you want to go." }],
            },
          },
        })}
      />
    );

    expect(screen.getByText("Cornering Flat Turn Precision")).toBeInTheDocument();
    expect(screen.getByText(/6 passages/)).toBeInTheDocument();
    expect(screen.getByText("Look where you want to go.")).toBeInTheDocument();
  });
});
