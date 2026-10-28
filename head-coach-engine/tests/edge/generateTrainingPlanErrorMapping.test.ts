// PILOT_015 — unit tests for supabase/functions/generate-training-plan/errorMapping.ts.
// Pure, deterministic, no DB/network. The error classes come from the same Edge
// bundle errorMapping imports, exactly like the deployed function (`instanceof`).
import { describe, expect, it } from "vitest";
import { dhUnitRefusalDetail, mapGenerateTrainingPlanError } from "../../../supabase/functions/generate-training-plan/errorMapping.js";
import {
  GenerationBlockedError,
  NoCompatibleDrillError,
  NoCompatibleExerciseError,
  PlanningModelAssignmentReadError,
} from "../../dist/edge/generateTrainingPlan.bundle.js";

describe("mapGenerateTrainingPlanError", () => {
  // BETA-V2-TECH-01 B — an unreadable or invalid assignment refuses before any generation: 503, retryable, never V1.
  it("maps PlanningModelAssignmentReadError to 503 beta_access_check_unavailable, never 500 nor a V1 plan", () => {
    for (const detail of ["42501", "unexpected planning_model", "query_failed"]) {
      const mapped = mapGenerateTrainingPlanError(new PlanningModelAssignmentReadError(detail));
      expect(mapped).toEqual({ status: 503, code: "beta_access_check_unavailable", message: "Training plan generation is temporarily unavailable." });
      expect(mapped.message).not.toContain(detail);
    }
  });

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

describe("V2-DH-ATTRIBUTION-01 — dhUnitRefusalDetail", () => {
  it("keeps the skill, level and drill (strings only), drops anything else", () => {
    expect(dhUnitRefusalDetail({ skill: "braking", dhTechnicalTier: "intermediate", drillId: "braking_late_entry", athleteId: "x", extra: 1 })).toEqual({ skill: "braking", dhTechnicalTier: "intermediate", drillId: "braking_late_entry" });
    expect(dhUnitRefusalDetail({ skill: 3 })).toEqual({ skill: null, dhTechnicalTier: null, drillId: null });
  });
});
