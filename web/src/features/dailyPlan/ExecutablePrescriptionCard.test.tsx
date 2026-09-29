import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExecutablePrescriptionCard } from "./ExecutablePrescriptionCard";
import type { ExecutablePrescription } from "./dailyPlanTypes";

const STRENGTH_PRESCRIPTION: ExecutablePrescription = {
  id: "prescription-1",
  generatedPlanSessionId: "session-1",
  schemaVersion: "v1",
  catalogVersion: "v1",
  structure: {
    domain: "strength",
    schemaVersion: "v1",
    blocks: [
      {
        role: "work",
        exerciseId: "back_squat",
        sets: 4,
        repScheme: { type: "fixed", reps: 5 },
        intensity: { type: "percent_1rm", value: 80 },
        restSeconds: 180,
        tempo: "31X1",
        unilateral: true,
      },
    ],
  },
};

const DH_PRESCRIPTION: ExecutablePrescription = {
  id: "prescription-2",
  generatedPlanSessionId: "session-2",
  schemaVersion: "v1",
  catalogVersion: "v1",
  structure: {
    domain: "dh_technical",
    schemaVersion: "v1",
    drills: [
      {
        drillId: "berm_carry_speed",
        skillTarget: "cornering",
        terrainRequirement: "flow_trail",
        runs: 6,
        executionCue: "Reste bas dans le virage.",
        successCriterion: "Vitesse constante sur les 3 derniers virages.",
        progressionCondition: "Augmenter la vitesse d'entrée si stable 3 runs de suite.",
        regressionCondition: "Réduire la vitesse en cas de perte de ligne.",
      },
    ],
  },
};

describe("ExecutablePrescriptionCard — strength domain", () => {
  it("renders the exercise name, sets/reps, intensity, rest, and optional tempo/unilateral", () => {
    render(<ExecutablePrescriptionCard prescription={STRENGTH_PRESCRIPTION} />);

    expect(screen.getByText("Exercices")).toBeInTheDocument();
    expect(screen.getByText("Travail")).toBeInTheDocument();
    expect(screen.getByText("Back Squat")).toBeInTheDocument();
    expect(screen.getByText("4 × 5 répétitions — 80% 1RM")).toBeInTheDocument();
    expect(screen.getByText("Repos : 180 s")).toBeInTheDocument();
    expect(screen.getByText("Tempo : 31X1")).toBeInTheDocument();
    expect(screen.getByText("Unilatéral")).toBeInTheDocument();
  });

  it("omits optional tempo/unilateral lines when absent", () => {
    const withoutOptionals: ExecutablePrescription = {
      ...STRENGTH_PRESCRIPTION,
      structure: {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [
          {
            role: "accessory",
            exerciseId: "lat_pulldown",
            sets: 3,
            repScheme: { type: "range", min: 8, max: 12 },
            intensity: { type: "rpe", target: 8 },
            restSeconds: 90,
          },
        ],
      },
    };
    render(<ExecutablePrescriptionCard prescription={withoutOptionals} />);

    expect(screen.getByText("Accessoire")).toBeInTheDocument();
    expect(screen.getByText("Lat Pulldown")).toBeInTheDocument();
    expect(screen.getByText("3 × 8-12 répétitions — RPE 8")).toBeInTheDocument();
    expect(screen.queryByText(/Tempo :/)).not.toBeInTheDocument();
    expect(screen.queryByText("Unilatéral")).not.toBeInTheDocument();
  });
});

describe("ExecutablePrescriptionCard — dh_technical domain", () => {
  it("renders the drill name, skill/terrain, runs, cue, success criterion, and optional progression/regression conditions", () => {
    render(<ExecutablePrescriptionCard prescription={DH_PRESCRIPTION} />);

    expect(screen.getByText("Exercices")).toBeInTheDocument();
    expect(screen.getByText("Berm Carry Speed")).toBeInTheDocument();
    expect(screen.getByText("Virages · Flow trail")).toBeInTheDocument();
    expect(screen.getByText("6 passages")).toBeInTheDocument();
    expect(screen.getByText("Reste bas dans le virage.")).toBeInTheDocument();
    expect(screen.getByText("Réussite : Vitesse constante sur les 3 derniers virages.")).toBeInTheDocument();
    expect(screen.getByText("Progression : Augmenter la vitesse d'entrée si stable 3 runs de suite.")).toBeInTheDocument();
    expect(screen.getByText("Régression : Réduire la vitesse en cas de perte de ligne.")).toBeInTheDocument();
  });

  it("omits optional progression/regression lines when absent", () => {
    const withoutOptionals: ExecutablePrescription = {
      ...DH_PRESCRIPTION,
      structure: {
        domain: "dh_technical",
        schemaVersion: "v1",
        drills: [
          {
            drillId: "root_section_control",
            skillTarget: "braking",
            terrainRequirement: "rock_garden",
            runs: 4,
            executionCue: "Regarde loin devant.",
            successCriterion: "Aucune perte de contrôle sur 4 runs.",
          },
        ],
      },
    };
    render(<ExecutablePrescriptionCard prescription={withoutOptionals} />);

    expect(screen.getByText("Root Section Control")).toBeInTheDocument();
    expect(screen.queryByText(/Progression :/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Régression :/)).not.toBeInTheDocument();
  });
});

// REV-015.2 — training vocabulary: repetitions, skill and terrain are French; unknown identifiers are never shown raw.
describe("ExecutablePrescriptionCard — training vocabulary (REV-015.2)", () => {
  function dhWith(skillTarget: string, terrainRequirement: string): ExecutablePrescription {
    return {
      ...DH_PRESCRIPTION,
      structure: {
        domain: "dh_technical",
        schemaVersion: "v1",
        drills: [{ drillId: "root_section_control", skillTarget, terrainRequirement, runs: 4, executionCue: "Regarde loin devant.", successCriterion: "Aucune perte de contrôle." }],
      },
    };
  }

  it("skill and terrain use their French labels", () => {
    render(<ExecutablePrescriptionCard prescription={dhWith("braking", "rock_garden")} />);

    expect(screen.getByText("Freinage · Pierrier / rock garden")).toBeInTheDocument();
    expect(screen.queryByText(/Braking|Rock Garden|rock_garden/)).not.toBeInTheDocument();
  });

  it("an unknown skill is left out, the known terrain stays", () => {
    render(<ExecutablePrescriptionCard prescription={dhWith("future_skill", "flow_trail")} />);

    expect(screen.getByText("Flow trail")).toBeInTheDocument();
    expect(screen.queryByText(/future_skill|Future Skill/)).not.toBeInTheDocument();
  });

  it("unknown skill and terrain: no context line at all, never a raw identifier", () => {
    const { container } = render(<ExecutablePrescriptionCard prescription={dhWith("future_skill", "future_terrain")} />);

    expect(container.textContent).not.toMatch(/future_skill|future_terrain|Future Skill|Future Terrain|·/);
  });

  it("a single repetition is singular; 'reps' never appears", () => {
    const one: ExecutablePrescription = {
      ...STRENGTH_PRESCRIPTION,
      structure: {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [{ role: "work", exerciseId: "back_squat", sets: 3, repScheme: { type: "fixed", reps: 1 }, intensity: { type: "rpe", target: 9 }, restSeconds: 180 }],
      },
    };
    const { container } = render(<ExecutablePrescriptionCard prescription={one} />);

    expect(screen.getByText("3 × 1 répétition — RPE 9")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\breps\b/);
  });
});
