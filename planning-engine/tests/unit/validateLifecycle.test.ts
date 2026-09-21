import { describe, expect, it } from "vitest";
import { validateLifecycleChain } from "../../src/validation/validateLifecycle.js";
import { PlanningEngineValidationError } from "../../src/validation/errors.js";
import type { TrainingPlanVersionLifecycleTransition } from "../../src/types/planLifecycle.js";

const BASE_ARGS = { planVersionId: "v1", createdAt: "2026-09-21T00:00:00Z" };

describe("validateLifecycleChain", () => {
  it("accepts a minimal valid chain: draft only", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [{ ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" }];
    expect(() => validateLifecycleChain(chain)).not.toThrow();
  });

  it("accepts draft -> accepted -> superseded", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [
      { ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" },
      { ...BASE_ARGS, id: "t2", transitionNumber: 2, supersedesId: "t1", state: "accepted" },
      { ...BASE_ARGS, id: "t3", transitionNumber: 3, supersedesId: "t2", state: "superseded", reason: "newer version accepted" },
    ];
    expect(() => validateLifecycleChain(chain)).not.toThrow();
  });

  it("accepts draft -> abandoned", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [
      { ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" },
      { ...BASE_ARGS, id: "t2", transitionNumber: 2, supersedesId: "t1", state: "abandoned", reason: "athlete declined" },
    ];
    expect(() => validateLifecycleChain(chain)).not.toThrow();
  });

  it("rejects an empty chain", () => {
    expect(() => validateLifecycleChain([])).toThrow(PlanningEngineValidationError);
  });

  it("rejects a chain not starting at draft", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [{ ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "accepted" }];
    expect(() => validateLifecycleChain(chain)).toThrow(PlanningEngineValidationError);
  });

  it("rejects accepted -> draft (illegal backward move)", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [
      { ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" },
      { ...BASE_ARGS, id: "t2", transitionNumber: 2, supersedesId: "t1", state: "accepted" },
      { ...BASE_ARGS, id: "t3", transitionNumber: 3, supersedesId: "t2", state: "draft" },
    ];
    expect(() => validateLifecycleChain(chain)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a transition out of an already-terminal state (superseded -> anything)", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [
      { ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" },
      { ...BASE_ARGS, id: "t2", transitionNumber: 2, supersedesId: "t1", state: "superseded", reason: "x" },
      { ...BASE_ARGS, id: "t3", transitionNumber: 3, supersedesId: "t2", state: "accepted" },
    ];
    expect(() => validateLifecycleChain(chain)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a skipped transitionNumber", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [
      { ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" },
      { ...BASE_ARGS, id: "t2", transitionNumber: 3, supersedesId: "t1", state: "accepted" },
    ];
    expect(() => validateLifecycleChain(chain)).toThrow(PlanningEngineValidationError);
  });

  it("rejects a mismatched supersedesId", () => {
    const chain: TrainingPlanVersionLifecycleTransition[] = [
      { ...BASE_ARGS, id: "t1", transitionNumber: 1, state: "draft" },
      { ...BASE_ARGS, id: "t2", transitionNumber: 2, supersedesId: "not-t1", state: "accepted" },
    ];
    expect(() => validateLifecycleChain(chain)).toThrow(PlanningEngineValidationError);
  });
});
