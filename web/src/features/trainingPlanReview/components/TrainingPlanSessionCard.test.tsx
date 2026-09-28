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
    expect(screen.getByText("Semaine standard de développement.")).toBeInTheDocument();
  });

  it("renders nothing extra when prescription is null (e.g. an aerobic session)", () => {
    render(<TrainingPlanSessionCard session={session({ kind: "AEROBIC_BASE", doseTarget: { domain: "aerobic", intensityZone: "easy" }, prescription: null })} />);

    expect(screen.queryByText(/séries/)).not.toBeInTheDocument();
    expect(screen.queryByText(/passages/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reps|RPE|Repos/)).not.toBeInTheDocument();
    expect(screen.getByText("Aerobic Base")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
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

  function strengthSession(block: Record<string, unknown>): TrainingPlanReviewSession {
    return session({
      prescription: {
        id: "prescription-1",
        generatedPlanSessionId: "session-1",
        structure: { domain: "strength", schemaVersion: "v1", blocks: [block] },
      },
    });
  }

  const COMPLETE_BLOCK = {
    role: "work",
    exerciseId: "barbell_back_squat",
    sets: 3,
    repScheme: { type: "fixed", reps: 8 },
    intensity: { type: "rpe", target: 7 },
    restSeconds: 120,
  };

  it("displays the complete strength prescription: sets × reps, RPE and rest (Today's format)", () => {
    render(<TrainingPlanSessionCard session={strengthSession(COMPLETE_BLOCK)} />);

    expect(screen.getByText("Barbell Back Squat")).toBeInTheDocument();
    expect(screen.getByText("3 × 8 reps — RPE 7")).toBeInTheDocument();
    expect(screen.getByText("Repos : 120 s")).toBeInTheDocument();
  });

  it("formats a range rep scheme like Today", () => {
    render(<TrainingPlanSessionCard session={strengthSession({ ...COMPLETE_BLOCK, sets: 12, repScheme: { type: "range", min: 8, max: 12 } })} />);

    expect(screen.getByText("12 × 8-12 reps — RPE 7")).toBeInTheDocument();
  });

  it("renders without crashing and without reps when repScheme is absent", () => {
    const { repScheme: _omitted, ...block } = COMPLETE_BLOCK;
    render(<TrainingPlanSessionCard session={strengthSession(block)} />);

    expect(screen.getByText("3 séries — RPE 7")).toBeInTheDocument();
    expect(screen.queryByText(/reps/)).not.toBeInTheDocument();
    expect(screen.getByText("Repos : 120 s")).toBeInTheDocument();
  });

  it("renders without crashing and without intensity when intensity is absent", () => {
    const { intensity: _omitted, ...block } = COMPLETE_BLOCK;
    render(<TrainingPlanSessionCard session={strengthSession(block)} />);

    expect(screen.getByText("3 × 8 reps")).toBeInTheDocument();
    expect(screen.queryByText(/RPE/)).not.toBeInTheDocument();
    expect(screen.getByText("Repos : 120 s")).toBeInTheDocument();
  });

  it("renders without crashing and without rest when restSeconds is absent", () => {
    const { restSeconds: _omitted, ...block } = COMPLETE_BLOCK;
    render(<TrainingPlanSessionCard session={strengthSession(block)} />);

    expect(screen.getByText("3 × 8 reps — RPE 7")).toBeInTheDocument();
    expect(screen.queryByText(/Repos/)).not.toBeInTheDocument();
  });

  it("omits malformed fields instead of rendering a fabricated value", () => {
    render(
      <TrainingPlanSessionCard
        session={strengthSession({
          exerciseId: "barbell_back_squat",
          sets: "3",
          repScheme: { type: "fixed" },
          intensity: { type: "unknown_type", target: 7 },
          restSeconds: null,
        })}
      />
    );

    expect(screen.getByText("Barbell Back Squat")).toBeInTheDocument();
    expect(screen.queryByText(/séries|reps|RPE|Repos|undefined|NaN/)).not.toBeInTheDocument();
  });

  it("does not crash on a non-object block", () => {
    render(<TrainingPlanSessionCard session={strengthSession(null as unknown as Record<string, unknown>)} />);

    expect(screen.getByText("Exercice")).toBeInTheDocument();
  });

  it("never displays internal prescription fields", () => {
    const { container } = render(
      <TrainingPlanSessionCard session={strengthSession({ ...COMPLETE_BLOCK, substitutionOf: "goblet_squat" })} />
    );

    const text = container.textContent ?? "";
    for (const internal of ["barbell_back_squat", "goblet_squat", "Goblet Squat", "schemaVersion", "v1", "work", "Travail", "fixed", "rpe", "repScheme", "restSeconds", "prescription-1"]) {
      expect(text).not.toContain(internal);
    }
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

// REV-013 — the session's English engine rationale is translated for display.
describe("TrainingPlanSessionCard — explanation (REV-013)", () => {
  it("translates every part of the session explanation, other fields unchanged", () => {
    render(
      <TrainingPlanSessionCard
        session={session({
          rationale:
            "Standard development week. Adjusted due to recent missed or replaced sessions pattern Reduced heavy strength load to avoid consecutive heavy strength sessions",
        })}
      />
    );

    expect(
      screen.getByText(
        "Semaine standard de développement. Charge allégée car plusieurs séances récentes ont été manquées ou remplacées. Charge de force réduite pour éviter deux séances lourdes d'affilée."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Adjusted|Reduced|heavy|pattern/)).not.toBeInTheDocument();
    expect(screen.getByText("Strength Lower")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("an unknown part is dropped, the known part is kept", () => {
    render(<TrainingPlanSessionCard session={session({ rationale: "Standard development week. New fatigue adjustment." })} />);

    expect(screen.getByText("Semaine standard de développement.")).toBeInTheDocument();
    expect(screen.queryByText(/fatigue adjustment/)).not.toBeInTheDocument();
  });

  it("an entirely unknown explanation shows the neutral sentence, never the English", () => {
    render(<TrainingPlanSessionCard session={session({ rationale: "Brand new engine explanation." })} />);

    expect(screen.getByText("Séance prévue par ton programme.")).toBeInTheDocument();
    expect(screen.queryByText(/Brand new/)).not.toBeInTheDocument();
  });

  it("an empty explanation renders no paragraph", () => {
    const { container } = render(<TrainingPlanSessionCard session={session({ rationale: "" })} />);

    expect(container.querySelectorAll("p")).toHaveLength(2); // duration + domain only
  });
});
