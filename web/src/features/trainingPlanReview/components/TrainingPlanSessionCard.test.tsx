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

    expect(screen.getByText("Renfo bas du corps")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
    expect(screen.getByText("Semaine standard de développement.")).toBeInTheDocument();
  });

  it("renders nothing extra when prescription is null (e.g. an aerobic session)", () => {
    render(<TrainingPlanSessionCard session={session({ kind: "AEROBIC_BASE", doseTarget: { domain: "aerobic", intensityZone: "easy" }, prescription: null })} />);

    expect(screen.queryByText(/séries/)).not.toBeInTheDocument();
    expect(screen.queryByText(/passages/)).not.toBeInTheDocument();
    expect(screen.queryByText(/répétitions?|RPE|Repos/)).not.toBeInTheDocument();
    expect(screen.getByText("Aérobie base")).toBeInTheDocument();
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

    expect(screen.getByText("Squat au poids du corps")).toBeInTheDocument();
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

    expect(screen.getByText("Squat arrière à la barre")).toBeInTheDocument();
    expect(screen.getByText("3 × 8 répétitions — RPE 7")).toBeInTheDocument();
    expect(screen.getByText("Repos : 120 s")).toBeInTheDocument();
  });

  it("formats a range rep scheme like Today", () => {
    render(<TrainingPlanSessionCard session={strengthSession({ ...COMPLETE_BLOCK, sets: 12, repScheme: { type: "range", min: 8, max: 12 } })} />);

    expect(screen.getByText("12 × 8-12 répétitions — RPE 7")).toBeInTheDocument();
  });

  it("renders without crashing and without reps when repScheme is absent", () => {
    const { repScheme: _omitted, ...block } = COMPLETE_BLOCK;
    render(<TrainingPlanSessionCard session={strengthSession(block)} />);

    expect(screen.getByText("3 séries — RPE 7")).toBeInTheDocument();
    expect(screen.queryByText(/répétitions?/)).not.toBeInTheDocument();
    expect(screen.getByText("Repos : 120 s")).toBeInTheDocument();
  });

  it("renders without crashing and without intensity when intensity is absent", () => {
    const { intensity: _omitted, ...block } = COMPLETE_BLOCK;
    render(<TrainingPlanSessionCard session={strengthSession(block)} />);

    expect(screen.getByText("3 × 8 répétitions")).toBeInTheDocument();
    expect(screen.queryByText(/RPE/)).not.toBeInTheDocument();
    expect(screen.getByText("Repos : 120 s")).toBeInTheDocument();
  });

  it("renders without crashing and without rest when restSeconds is absent", () => {
    const { restSeconds: _omitted, ...block } = COMPLETE_BLOCK;
    render(<TrainingPlanSessionCard session={strengthSession(block)} />);

    expect(screen.getByText("3 × 8 répétitions — RPE 7")).toBeInTheDocument();
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

    expect(screen.getByText("Squat arrière à la barre")).toBeInTheDocument();
    expect(screen.queryByText(/séries|répétitions?|RPE|Repos|undefined|NaN/)).not.toBeInTheDocument();
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

    expect(screen.getByText("Précision de trajectoire en virage plat")).toBeInTheDocument();
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
    expect(screen.getByText("Renfo bas du corps")).toBeInTheDocument();
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

// REV-015.2 — session kind badge and domain line are French; unknown identifiers are never shown raw.
describe("TrainingPlanSessionCard — training vocabulary (REV-015.2)", () => {
  it.each([
    ["STRENGTH_LOWER", "Renfo bas du corps"],
    ["STRENGTH_UPPER", "Renfo haut du corps"],
    ["DH_TECHNICAL", "DH technique"],
    ["AEROBIC_BASE", "Aérobie base"],
  ])("kind %s → badge %s", (kind, label) => {
    render(<TrainingPlanSessionCard session={session({ kind })} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`^${kind}$`, "i"))).not.toBeInTheDocument();
  });

  it("an unknown kind shows the neutral 'Séance d'entraînement', never the identifier", () => {
    render(<TrainingPlanSessionCard session={session({ kind: "FUTURE_KIND" })} />);

    expect(screen.getByText("Séance d'entraînement")).toBeInTheDocument();
    expect(screen.queryByText(/FUTURE_KIND|Future Kind/)).not.toBeInTheDocument();
  });

  it.each([
    [{ domain: "strength", setVolume: 12, targetRpeOrRir: 7 }, "Force"],
    [{ domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 }, "DH"],
    [{ domain: "aerobic", intensityZone: "moderate" }, "Aérobie"],
  ])("domain line is French (%j)", (doseTarget, label) => {
    render(<TrainingPlanSessionCard session={session({ doseTarget })} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/^(Strength|Dh Technical|Aerobic)$/)).not.toBeInTheDocument();
  });

  it("an unknown domain hides the line", () => {
    const { container } = render(<TrainingPlanSessionCard session={session({ doseTarget: { domain: "future_domain" } })} />);

    expect(container.textContent).not.toMatch(/future_domain|Future Domain/);
  });

  it("a drill without an id falls back to 'Exercice technique', never 'Drill'", () => {
    render(
      <TrainingPlanSessionCard
        session={session({
          kind: "DH_TECHNICAL",
          doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 },
          prescription: { id: "p-3", generatedPlanSessionId: "session-1", structure: { domain: "dh_technical", schemaVersion: "v1", drills: [{ runs: 4 }] } },
        })}
      />
    );

    expect(screen.getByText("Exercice technique")).toBeInTheDocument();
    expect(screen.queryByText(/^Drill$/)).not.toBeInTheDocument();
  });
});

// REV-015.3 — the exercise/drill ids actually stored in production plans (read-only audit, 2026-09-29)
// render as French labels; unknown ids render the neutral labels.
describe("TrainingPlanSessionCard — exercise and drill names (REV-015.3)", () => {
  const STORED_EXERCISES: ReadonlyArray<readonly [string, string]> = [
    ["barbell_back_squat", "Squat arrière à la barre"],
    ["barbell_bench_press", "Développé couché à la barre"],
    ["bodyweight_squat", "Squat au poids du corps"],
    ["dumbbell_bench_press", "Développé couché aux haltères"],
    ["goblet_squat", "Goblet squat"],
    ["pushup", "Pompes"],
  ];
  const STORED_DRILLS: ReadonlyArray<readonly [string, string]> = [
    ["braking_late_entry", "Freinage tardif, relâchement précoce"],
    ["cornering_flat_turn_precision", "Précision de trajectoire en virage plat"],
    ["line_choice_rock_garden", "Choix de ligne dans le pierrier"],
    ["race_execution_full_run_sim", "Simulation de run complet"],
    ["race_execution_split_pace", "Run fractionné à allure course"],
    ["roots_rocks_committed", "Racines et rochers engagés, à vitesse"],
  ];

  it.each(STORED_EXERCISES)("existing plan exercise %s → %s", (exerciseId, label) => {
    render(
      <TrainingPlanSessionCard
        session={session({ prescription: { id: "p", generatedPlanSessionId: "session-1", structure: { domain: "strength", schemaVersion: "v1", blocks: [{ role: "work", exerciseId, sets: 12 }] } } })}
      />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(exerciseId))).not.toBeInTheDocument();
  });

  it.each(STORED_DRILLS)("existing plan drill %s → %s", (drillId, label) => {
    render(
      <TrainingPlanSessionCard
        session={session({
          kind: "DH_TECHNICAL",
          doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 },
          prescription: { id: "p", generatedPlanSessionId: "session-1", structure: { domain: "dh_technical", schemaVersion: "v1", drills: [{ drillId, runs: 6 }] } },
        })}
      />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(drillId))).not.toBeInTheDocument();
  });

  it("unknown ids show 'Exercice' / 'Exercice technique', never the id", () => {
    const { container } = render(
      <TrainingPlanSessionCard
        session={session({ prescription: { id: "p", generatedPlanSessionId: "session-1", structure: { domain: "strength", schemaVersion: "v1", blocks: [{ exerciseId: "unknown_exercise_42", sets: 3 }] } } })}
      />
    );

    expect(screen.getByText("Exercice")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/unknown_exercise_42|Unknown Exercise/);
  });
});

// REV-015.4b — Programme drill instruction is French when the stored English is exactly the catalogue source.
describe("TrainingPlanSessionCard — drill instruction (REV-015.4b)", () => {
  function dhSession(drillId: string, executionCue: unknown) {
    return session({
      kind: "DH_TECHNICAL",
      doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 6 },
      prescription: { id: "p", generatedPlanSessionId: "session-1", structure: { domain: "dh_technical", schemaVersion: "v1", drills: [{ drillId, runs: 6, executionCue }] } },
    });
  }

  it("catalogue English → French instruction", () => {
    const cue = "Ride the full track at race intent from the first gate to the finish line — treat every section like it counts.";
    const { container } = render(<TrainingPlanSessionCard session={dhSession("race_execution_full_run_sim", cue)} />);

    expect(screen.getByText("Roule la piste complète en mode course, du départ jusqu'à l'arrivée — traite chaque section comme si elle comptait.")).toBeInTheDocument();
    expect(container.textContent).not.toContain(cue);
  });

  it("drifted text is kept as stored; a missing instruction renders nothing", () => {
    const { unmount } = render(<TrainingPlanSessionCard session={dhSession("race_execution_full_run_sim", "Ride it all.")} />);
    expect(screen.getByText("Ride it all.")).toBeInTheDocument();
    unmount();

    const { container } = render(<TrainingPlanSessionCard session={dhSession("race_execution_full_run_sim", undefined)} />);
    expect(container.querySelectorAll("li p")).toHaveLength(0);
  });
});
