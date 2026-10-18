import { describe, expect, it, vi } from "vitest";
import { parseV2PlanGenerationFlag } from "../../src/generation/planningModelRollout.js";
import { V2_L2_HISTORY_FLAG } from "../../src/generation/planHistoryRolloutV2.js";
import { generateTrainingPlanForAthlete, type GenerateTrainingPlanForAthleteDeps } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { generateAndPersistTrainingPlanV2, type GenerateAndPersistTrainingPlanV2Deps } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import * as edgeEntry from "../../src/edge/generateTrainingPlanEdgeEntry.js";

// V2-L2-01a — the V2 history switch, from the Edge secret to the V2 snapshot: only "true" turns it on, V2 only.

describe("V2-L2-01a — NALYNT_V2_L2_HISTORY_ENABLED", () => {
  it("the secret's name, exported by the Edge bundle entry; only the exact value \"true\" turns it on", () => {
    expect(V2_L2_HISTORY_FLAG).toBe("NALYNT_V2_L2_HISTORY_ENABLED");
    expect(edgeEntry.V2_L2_HISTORY_FLAG).toBe(V2_L2_HISTORY_FLAG);
    expect(parseV2PlanGenerationFlag("true")).toBe(true);
    for (const raw of [undefined, null, "", "TRUE", "1", "yes", " true"]) expect(parseV2PlanGenerationFlag(raw as string | undefined)).toBe(false);
  });

  it("generateAndPersistTrainingPlanV2: OFF → the snapshot builder is called exactly as before (4 arguments); ON → with { v2History: true }", async () => {
    const stop = new Error("stop after the snapshot");
    const call = async (v2History: boolean | undefined) => {
      const build = vi.fn(async () => Promise.reject(stop));
      const deps = { buildPlanInputSnapshotV2: build, callRpc: vi.fn(), mintId: () => "id" } as unknown as GenerateAndPersistTrainingPlanV2Deps;
      await expect(
        generateAndPersistTrainingPlanV2({ planningModel: "v2", client: {} as never, athleteId: "a", generationRequestId: "r", durationWeeks: 2, today: "2026-11-02", ...(v2History !== undefined ? { v2History } : {}) }, deps)
      ).rejects.toBe(stop);
      return build.mock.calls[0] as unknown[];
    };
    const horizon = { startDate: "2026-11-03", endDate: "2026-11-16" };
    expect(await call(undefined)).toEqual([{}, "a", "2026-11-02", horizon]);
    expect(await call(false)).toEqual([{}, "a", "2026-11-02", horizon]);
    expect(await call(true)).toEqual([{}, "a", "2026-11-02", horizon, undefined, { v2History: true }]);
  });

  it("generateTrainingPlanForAthlete: passed to the V2 path only when true; the V1 path never receives it", async () => {
    const run = async (assignment: "v1" | "v2", v2History: boolean | undefined) => {
      const deps: GenerateTrainingPlanForAthleteDeps = {
        getPlanningModelAssignment: vi.fn(async () => assignment),
        generateAndPersistTrainingPlan: vi.fn(async () => ({ planVersionId: "p1", idempotentReplay: false })) as unknown as GenerateTrainingPlanForAthleteDeps["generateAndPersistTrainingPlan"],
        generateAndPersistTrainingPlanV2: vi.fn(async () => ({ status: "persisted" as const, planVersionId: "p2", idempotentReplay: false, plan: {} as never })),
      };
      await generateTrainingPlanForAthlete(
        { client: {} as never, athleteId: "a", generationRequestId: "r", durationWeeks: 2, today: "2026-11-02", globalV2Enabled: true, ...(v2History !== undefined ? { v2History } : {}) },
        deps
      );
      return deps;
    };
    expect((await run("v2", true)).generateAndPersistTrainingPlanV2).toHaveBeenCalledWith(expect.objectContaining({ v2History: true }));
    for (const off of [undefined, false]) expect(Object.keys((vi.mocked((await run("v2", off)).generateAndPersistTrainingPlanV2).mock.calls[0]![0]))).not.toContain("v2History");
    const v1 = await run("v1", true);
    expect(v1.generateAndPersistTrainingPlanV2).not.toHaveBeenCalled();
    expect(Object.keys(vi.mocked(v1.generateAndPersistTrainingPlan).mock.calls[0]![0] as object)).not.toContain("v2History");
  });
});
