import { describe, expect, it, vi } from "vitest";
import { parseV2PlanGenerationFlag, resolvePlanningModelForAthlete, V2_PLAN_GENERATION_FLAG } from "../../src/generation/planningModelRollout.js";
import { generateTrainingPlanForAthlete, planningResolutionOf, type GenerateTrainingPlanForAthleteDeps } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { toPilotEventRow } from "../../src/supabase/observability/pilotEvents.js";

describe("UX-11R.2 — global switch parsing (server-only)", () => {
  it("only the exact value \"true\" turns V2 eligibility on", () => {
    expect(V2_PLAN_GENERATION_FLAG).toBe("NALYNT_V2_PLAN_GENERATION_ENABLED");
    expect(parseV2PlanGenerationFlag("true")).toBe(true);
    for (const raw of [undefined, null, "", "TRUE", "True", "1", "yes", "on", " true", "true "]) expect(parseV2PlanGenerationFlag(raw as string | undefined), String(raw)).toBe(false);
  });
});

describe("UX-11R.2 — resolvePlanningModelForAthlete", () => {
  it.each([
    [false, null, "v1", "global_v2_disabled"],
    [false, "v2", "v1", "global_v2_disabled"],
    [false, "v1", "v1", "global_v2_disabled"],
    [true, null, "v1", "default_v1"],
    [true, "v1", "v1", "assigned_v1"],
    [true, "v2", "v2", "assigned_v2"],
  ] as const)("switch %s + assignment %s → %s (%s)", (globalV2Enabled, assignment, planningModel, reason) => {
    expect(resolvePlanningModelForAthlete({ globalV2Enabled, assignment })).toEqual({ planningModel, reason });
  });
});

function fakeDeps(assignment: "v1" | "v2" | null) {
  const deps: GenerateTrainingPlanForAthleteDeps = {
    getPlanningModelAssignment: vi.fn(async () => assignment),
    generateAndPersistTrainingPlan: vi.fn(async () => ({ planVersionId: "v1-plan", idempotentReplay: false })) as unknown as GenerateTrainingPlanForAthleteDeps["generateAndPersistTrainingPlan"],
    generateAndPersistTrainingPlanV2: vi.fn(async () => ({ status: "persisted" as const, planVersionId: "v2-plan", idempotentReplay: false, plan: {} as never })),
  };
  return deps;
}
const input = (globalV2Enabled: boolean) => ({ client: {} as never, athleteId: "a", generationRequestId: "r", durationWeeks: 2, today: "2026-10-05", globalV2Enabled });

describe("UX-11R.2 — generateTrainingPlanForAthlete (single server entry)", () => {
  it("switch off: the assignment is not even read; the exact V1 path runs", async () => {
    const deps = fakeDeps("v2");
    expect(await generateTrainingPlanForAthlete(input(false), deps)).toEqual({ planningModel: "v1", reason: "global_v2_disabled", status: "persisted", planVersionId: "v1-plan", idempotentReplay: false });
    expect(deps.getPlanningModelAssignment).not.toHaveBeenCalled();
    expect(deps.generateAndPersistTrainingPlanV2).not.toHaveBeenCalled();
  });

  it("switch on + assigned v2: the validated V2 path, with the explicit planningModel", async () => {
    const deps = fakeDeps("v2");
    expect(await generateTrainingPlanForAthlete(input(true), deps)).toMatchObject({ planningModel: "v2", reason: "assigned_v2", status: "persisted", planVersionId: "v2-plan" });
    expect(deps.generateAndPersistTrainingPlanV2).toHaveBeenCalledWith(expect.objectContaining({ planningModel: "v2", athleteId: "a", generationRequestId: "r" }));
    expect(deps.generateAndPersistTrainingPlan).not.toHaveBeenCalled();
  });

  it("switch on + not assigned / assigned v1: V1", async () => {
    expect(await generateTrainingPlanForAthlete(input(true), fakeDeps(null))).toMatchObject({ planningModel: "v1", reason: "default_v1" });
    expect(await generateTrainingPlanForAthlete(input(true), fakeDeps("v1"))).toMatchObject({ planningModel: "v1", reason: "assigned_v1" });
  });

  it("a blocked V2 generation is returned as such, never replaced by a V1 plan", async () => {
    const deps = fakeDeps("v2");
    deps.generateAndPersistTrainingPlanV2 = vi.fn(async () => ({ status: "blocked" as const, code: "missing_dh_technical_tier" as const, detail: {} }));
    expect(await generateTrainingPlanForAthlete(input(true), deps)).toMatchObject({ planningModel: "v2", status: "blocked", code: "missing_dh_technical_tier" });
    expect(deps.generateAndPersistTrainingPlan).not.toHaveBeenCalled();
  });

  it("a failing V2 generation rethrows the same error (no fallback), with the resolution attached for observability", async () => {
    const deps = fakeDeps("v2");
    const boom = new TypeError("v2 failure");
    deps.generateAndPersistTrainingPlanV2 = vi.fn(async () => {
      throw boom;
    });
    await expect(generateTrainingPlanForAthlete(input(true), deps)).rejects.toBe(boom);
    expect(planningResolutionOf(boom)).toEqual({ planningModel: "v2", reason: "assigned_v2" });
    expect(deps.generateAndPersistTrainingPlan).not.toHaveBeenCalled();
  });

  it("an unreadable assignment fails the generation (never a silent V1)", async () => {
    const deps = fakeDeps(null);
    deps.getPlanningModelAssignment = vi.fn(async () => {
      throw new Error("read failed");
    });
    await expect(generateTrainingPlanForAthlete(input(true), deps)).rejects.toThrow("read failed");
    expect(deps.generateAndPersistTrainingPlan).not.toHaveBeenCalled();
  });
});

describe("UX-11R.2 — generation pilot events carry the planning model (no new identifier)", () => {
  it("succeeded / blocked / failed", () => {
    expect(toPilotEventRow({ eventType: "plan_generation_succeeded", athleteId: "a", planVersionId: "p", generationRequestId: "r", idempotentReplay: false, durationWeeks: 2, planningModel: "v2", rolloutReason: "assigned_v2" }).metadata).toEqual({ idempotentReplay: false, durationWeeks: 2, planningModel: "v2", rolloutReason: "assigned_v2" });
    expect(toPilotEventRow({ eventType: "plan_generation_blocked", athleteId: "a", generationRequestId: "r", blockedReason: "missing_dh_technical_tier", planningModel: "v2", rolloutReason: "assigned_v2" }).metadata).toEqual({ blockedReason: "missing_dh_technical_tier", planningModel: "v2", rolloutReason: "assigned_v2" });
    expect(toPilotEventRow({ eventType: "plan_generation_failed", athleteId: "a", generationRequestId: "r", errorName: "TypeError", errorCode: "internal_error", planningModel: "v1", rolloutReason: "global_v2_disabled" }).metadata).toEqual({ errorName: "TypeError", errorCode: "internal_error", planningModel: "v1", rolloutReason: "global_v2_disabled" });
    // Unchanged when no model was resolved (e.g. before resolution).
    expect(toPilotEventRow({ eventType: "plan_generation_failed", athleteId: "a", generationRequestId: "r", errorName: "E", errorCode: "internal_error" }).metadata).toEqual({ errorName: "E", errorCode: "internal_error" });
  });
});
