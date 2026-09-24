// PILOT_015 — unit tests for supabase/functions/generate-training-plan/errorMapping.ts.
// Pure, deterministic, no DB/network. The error classes come from the same Edge
// bundle errorMapping imports, exactly like the deployed function (`instanceof`).
import { describe, expect, it } from "vitest";
import { mapGenerateTrainingPlanError } from "../../../supabase/functions/generate-training-plan/errorMapping.js";
import {
  GenerationBlockedError,
  NoCompatibleDrillError,
  NoCompatibleExerciseError,
} from "../../dist/edge/generateTrainingPlan.bundle.js";

describe("mapGenerateTrainingPlanError", () => {
  it.each(["missing_availability", "missing_performance_profile", "missing_discipline", "missing_strength_experience_tier"] as const)(
    "maps GenerationBlockedError(%s) to 422 with the reason as code",
    (reason) => {
      const mapped = mapGenerateTrainingPlanError(new GenerationBlockedError(reason));
      expect(mapped.status).toBe(422);
      expect(mapped.code).toBe(reason);
    }
  );

  // Production 2026-09-24: an intermediate DH athlete with priority race_execution
  // (catalogue: race_execution drill exists at advanced only) got a 500 "Erreur serveur".
  it("maps NoCompatibleDrillError (valid setup, no drill for priority/tier/terrain) to 422 no_compatible_drill, never 500", () => {
    const error = new NoCompatibleDrillError(
      "race_execution",
      'no drill compatible with terrainAccess=[full_dh_track] and difficulty="intermediate" exists for skillTarget "race_execution"'
    );
    const mapped = mapGenerateTrainingPlanError(error);
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("no_compatible_drill");
    expect(mapped.message).not.toContain("race_execution");
  });

  it("maps NoCompatibleExerciseError to 422 no_compatible_exercise, never 500", () => {
    const mapped = mapGenerateTrainingPlanError(new NoCompatibleExerciseError("squat", "no exercise for equipment=[]"));
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("no_compatible_exercise");
  });

  it("keeps an unknown error a 500 internal_error", () => {
    const mapped = mapGenerateTrainingPlanError(new Error("boom"));
    expect(mapped).toEqual({ status: 500, code: "internal_error", message: mapped.message });
  });
});
