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
        exerciseId: "barbell_back_squat",
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
        drillId: "cornering_berm_speed",
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
    expect(screen.getByText("Squat arrière à la barre")).toBeInTheDocument();
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
    expect(screen.getByText("Tirage vertical à la poulie")).toBeInTheDocument();
    expect(screen.getByText("3 × 8-12 répétitions — RPE 8")).toBeInTheDocument();
    expect(screen.queryByText(/Tempo :/)).not.toBeInTheDocument();
    expect(screen.queryByText("Unilatéral")).not.toBeInTheDocument();
  });
});

describe("ExecutablePrescriptionCard — dh_technical domain", () => {
  it("renders the drill name, skill/terrain, runs, cue, success criterion, and optional progression/regression conditions", () => {
    render(<ExecutablePrescriptionCard prescription={DH_PRESCRIPTION} />);

    expect(screen.getByText("Exercices")).toBeInTheDocument();
    expect(screen.getByText("Garder la vitesse dans les virages relevés")).toBeInTheDocument();
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
            drillId: "roots_rocks_rolling",
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

    expect(screen.getByText("Rouler sur racines et rochers")).toBeInTheDocument();
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
        drills: [{ drillId: "roots_rocks_rolling", skillTarget, terrainRequirement, runs: 4, executionCue: "Regarde loin devant.", successCriterion: "Aucune perte de contrôle." }],
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
        blocks: [{ role: "work", exerciseId: "barbell_back_squat", sets: 3, repScheme: { type: "fixed", reps: 1 }, intensity: { type: "rpe", target: 9 }, restSeconds: 180 }],
      },
    };
    const { container } = render(<ExecutablePrescriptionCard prescription={one} />);

    expect(screen.getByText("3 × 1 répétition — RPE 9")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\breps\b/);
  });
});

// REV-015.3 — exercise and drill names are French labels of their catalogue id; an unknown id is never shown.
describe("ExecutablePrescriptionCard — exercise and drill names (REV-015.3)", () => {
  it("unknown exercise and drill ids show the neutral labels, never the id", () => {
    const strength: ExecutablePrescription = {
      ...STRENGTH_PRESCRIPTION,
      structure: {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [{ role: "work", exerciseId: "unknown_exercise_42", sets: 3, repScheme: { type: "fixed", reps: 5 }, intensity: { type: "rpe", target: 7 }, restSeconds: 90 }],
      },
    };
    const dh: ExecutablePrescription = {
      ...DH_PRESCRIPTION,
      structure: {
        domain: "dh_technical",
        schemaVersion: "v1",
        drills: [{ drillId: "unknown_drill_7", skillTarget: "braking", terrainRequirement: "flow_trail", runs: 4, executionCue: "Regarde loin devant.", successCriterion: "Aucune perte de contrôle." }],
      },
    };

    const { container, unmount } = render(<ExecutablePrescriptionCard prescription={strength} />);
    expect(screen.getByText("Exercice")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/unknown_exercise_42|Unknown Exercise/);
    unmount();

    const dhRender = render(<ExecutablePrescriptionCard prescription={dh} />);
    expect(screen.getByText("Exercice technique")).toBeInTheDocument();
    expect(dhRender.container.textContent).not.toMatch(/unknown_drill_7|Unknown Drill/);
  });

  it("kept sport terms are shown as validated (Goblet squat)", () => {
    const goblet: ExecutablePrescription = {
      ...STRENGTH_PRESCRIPTION,
      structure: {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [{ role: "work", exerciseId: "goblet_squat", sets: 3, repScheme: { type: "range", min: 8, max: 12 }, intensity: { type: "rpe", target: 7 }, restSeconds: 90 }],
      },
    };
    render(<ExecutablePrescriptionCard prescription={goblet} />);

    expect(screen.getByText("Goblet squat")).toBeInTheDocument();
  });
});

// REV-015.4b — drill instruction and success criterion are French when the stored English is exactly the catalogue source.
describe("ExecutablePrescriptionCard — drill instructions (REV-015.4b)", () => {
  function drillWith(executionCue: string, successCriterion: string, drillId = "race_execution_split_pace"): ExecutablePrescription {
    return {
      ...DH_PRESCRIPTION,
      structure: {
        domain: "dh_technical",
        schemaVersion: "v1",
        drills: [{ drillId, skillTarget: "race_execution", terrainRequirement: "full_dh_track", runs: 4, executionCue, successCriterion }],
      },
    };
  }
  const SPLIT_CUE =
    "Mark a 1–2 minute technical section with a midway split, ride it at race intent from a standing start, then compare the two splits and repeat, fixing the slower half.";
  const SPLIT_CRITERION = "Rides the section at race intent with both splits within 3% of the best run on 2/3 runs.";

  it("a stored plan with the catalogue English shows the French instruction and criterion, never the English", () => {
    const { container } = render(<ExecutablePrescriptionCard prescription={drillWith(SPLIT_CUE, SPLIT_CRITERION)} />);

    expect(
      screen.getByText(
        "Marque une section technique de 1 à 2 minutes avec un split à mi-parcours, roule-la en mode course depuis un départ arrêté, puis compare les deux splits et recommence en corrigeant la moitié la plus lente."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Réussite : Tu roules la section en mode course, tes deux splits à moins de 3 % de ton meilleur run, sur 2 runs sur 3.")).toBeInTheDocument();
    expect(container.textContent).not.toContain(SPLIT_CUE);
    expect(container.textContent).not.toContain(SPLIT_CRITERION);
  });

  it("a drifted English text is kept as stored (the instruction stays available)", () => {
    render(<ExecutablePrescriptionCard prescription={drillWith("Ride the section twice.", "Two clean runs.")} />);

    expect(screen.getByText("Ride the section twice.")).toBeInTheDocument();
    expect(screen.getByText("Réussite : Two clean runs.")).toBeInTheDocument();
  });

  it("an unknown drill keeps its stored instruction", () => {
    render(<ExecutablePrescriptionCard prescription={drillWith("Instruction future.", "Critère futur.", "unknown_drill_7")} />);

    expect(screen.getByText("Instruction future.")).toBeInTheDocument();
    expect(screen.getByText("Réussite : Critère futur.")).toBeInTheDocument();
  });

  it("an empty criterion shows no 'Réussite' line, no crash", () => {
    render(<ExecutablePrescriptionCard prescription={drillWith(SPLIT_CUE, "")} />);

    expect(screen.queryByText(/Réussite :/)).not.toBeInTheDocument();
  });
});
