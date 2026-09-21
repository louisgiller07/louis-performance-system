import { describe, expect, it } from "vitest";
import { validatePrescriptionStructure } from "../../src/validation/validatePrescription.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";
import type { StrengthPrescription } from "../../src/types/strengthPrescription.js";
import type { DhTechnicalPrescription } from "../../src/types/dhPrescription.js";

const VALID_STRENGTH: StrengthPrescription = {
  domain: "strength",
  schemaVersion: "v1",
  blocks: [
    {
      role: "warm_up",
      exerciseId: "bodyweight_squat",
      sets: 2,
      repScheme: { type: "fixed", reps: 10 },
      intensity: { type: "bodyweight" },
      restSeconds: 30,
    },
    {
      role: "work",
      exerciseId: "barbell_back_squat",
      sets: 4,
      repScheme: { type: "range", min: 4, max: 6 },
      intensity: { type: "rpe", target: 8 },
      restSeconds: 150,
    },
  ],
};

const VALID_DH: DhTechnicalPrescription = {
  domain: "dh_technical",
  schemaVersion: "v1",
  drills: [
    {
      drillId: "cornering_berm_speed",
      skillTarget: "cornering",
      terrainRequirement: "bermed_trail",
      runs: 6,
      executionCue: "Weight forward through the berm, eyes to exit.",
      successCriterion: "Exits faster than entry on 3/5 runs.",
    },
  ],
};

describe("validatePrescriptionStructure — accepts valid structures", () => {
  it("accepts a valid strength prescription", () => {
    expect(() => validatePrescriptionStructure(VALID_STRENGTH)).not.toThrow();
  });

  it("accepts a valid dh_technical prescription", () => {
    expect(() => validatePrescriptionStructure(VALID_DH)).not.toThrow();
  });

  it("accepts every intensity modality", () => {
    const modalities: StrengthPrescription["blocks"][number]["intensity"][] = [
      { type: "rpe", target: 7 },
      { type: "rir", target: 2 },
      { type: "percent_1rm", value: 75 },
      { type: "fixed_load_kg", value: 40 },
      { type: "training_max_percent", value: 80 },
      { type: "bodyweight" },
    ];
    for (const intensity of modalities) {
      const prescription: StrengthPrescription = {
        domain: "strength",
        schemaVersion: "v1",
        blocks: [{ role: "work", exerciseId: "pushup", sets: 3, repScheme: { type: "amrap" }, intensity, restSeconds: 60 }],
      };
      expect(() => validatePrescriptionStructure(prescription)).not.toThrow();
    }
  });
});

describe("validatePrescriptionStructure — rejects invalid discriminators/data", () => {
  it("rejects an unknown domain", () => {
    const invalid = { domain: "cardio", schemaVersion: "v1" } as unknown as StrengthPrescription;
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });

  it("rejects an unknown exerciseId", () => {
    const invalid: StrengthPrescription = {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [{ role: "work", exerciseId: "not_a_real_exercise", sets: 3, repScheme: { type: "fixed", reps: 5 }, intensity: { type: "bodyweight" }, restSeconds: 60 }],
    };
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });

  it("rejects an unknown drillId", () => {
    const invalid: DhTechnicalPrescription = {
      domain: "dh_technical",
      schemaVersion: "v1",
      drills: [{ drillId: "not_a_real_drill", skillTarget: "cornering", terrainRequirement: "flow_trail", runs: 3, executionCue: "x", successCriterion: "y" }],
    };
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });

  it("rejects rpe outside 0-10", () => {
    const invalid: StrengthPrescription = {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [{ role: "work", exerciseId: "pushup", sets: 3, repScheme: { type: "fixed", reps: 5 }, intensity: { type: "rpe", target: 11 }, restSeconds: 60 }],
    };
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a rep range where max < min", () => {
    const invalid: StrengthPrescription = {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [{ role: "work", exerciseId: "pushup", sets: 3, repScheme: { type: "range", min: 10, max: 5 }, intensity: { type: "bodyweight" }, restSeconds: 60 }],
    };
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });

  it("rejects zero sets", () => {
    const invalid: StrengthPrescription = {
      domain: "strength",
      schemaVersion: "v1",
      blocks: [{ role: "work", exerciseId: "pushup", sets: 0, repScheme: { type: "fixed", reps: 5 }, intensity: { type: "bodyweight" }, restSeconds: 60 }],
    };
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });

  it("rejects an empty drills array", () => {
    const invalid: DhTechnicalPrescription = { domain: "dh_technical", schemaVersion: "v1", drills: [] };
    expect(() => validatePrescriptionStructure(invalid)).toThrow(PlanningEngineValidationError);
  });
});
