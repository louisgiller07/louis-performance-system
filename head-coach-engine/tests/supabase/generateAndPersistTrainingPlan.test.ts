import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshot } from "planning-engine";
import {
  generateAndPersistTrainingPlan,
  type GenerateAndPersistTrainingPlanDeps,
  type GenerateAndPersistTrainingPlanInput,
} from "../../src/supabase/generateAndPersistTrainingPlan.js";
import type { buildPlanInputSnapshot } from "../../src/supabase/buildPlanInputSnapshot.js";
import type { persistGeneratedTrainingPlan, PersistGeneratedTrainingPlanInput } from "../../src/supabase/persistGeneratedTrainingPlan.js";
import type { GenerationEngineInput } from "../../src/generation/generationEngine.js";
import type { GenerateTrainingPlanVersionResult } from "../../src/supabase/rpc/generateTrainingPlanVersionRpc.js";

const ATHLETE_ID = "athlete-1";
const GENERATION_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-09-23";
const FAKE_CLIENT = {} as SupabaseClient;

const BLOCK: GenerationEngineInput["block"] = {
  sequenceNumber: 1,
  name: "Test block",
  mode: "IN_SEASON",
  primaryFocus: "test",
  startDate: "2026-10-19",
  endDate: "2026-10-25",
};

const SNAPSHOT: PlanInputSnapshot = {
  discipline: "Downhill",
  races: [],
  availability: { windows: [{ dayOfWeek: 2, startTime: "16:00", endTime: "20:00" }], exceptions: [] },
  equipment: ["barbell"],
  terrainAccess: ["flow_trail"],
  strengthExperienceTier: "beginner",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
};

const RESULT: GenerateTrainingPlanVersionResult = { planVersionId: "version-1", idempotentReplay: false };

function baseInput(overrides: Partial<GenerateAndPersistTrainingPlanInput> = {}): GenerateAndPersistTrainingPlanInput {
  return {
    client: FAKE_CLIENT,
    athleteId: ATHLETE_ID,
    generationRequestId: GENERATION_REQUEST_ID,
    block: BLOCK,
    today: TODAY,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<GenerateAndPersistTrainingPlanDeps> = {}): GenerateAndPersistTrainingPlanDeps {
  return {
    buildPlanInputSnapshot: vi.fn<typeof buildPlanInputSnapshot>(async () => SNAPSHOT),
    persistGeneratedTrainingPlan: vi.fn<typeof persistGeneratedTrainingPlan>(async () => RESULT),
    ...overrides,
  };
}

describe("generateAndPersistTrainingPlan — V0.5_010", () => {
  it("1. calls buildPlanInputSnapshot before persistGeneratedTrainingPlan, in that order", async () => {
    const callOrder: string[] = [];
    const deps = buildDeps({
      buildPlanInputSnapshot: vi.fn<typeof buildPlanInputSnapshot>(async () => {
        callOrder.push("buildPlanInputSnapshot");
        return SNAPSHOT;
      }),
      persistGeneratedTrainingPlan: vi.fn<typeof persistGeneratedTrainingPlan>(async () => {
        callOrder.push("persistGeneratedTrainingPlan");
        return RESULT;
      }),
    });

    await generateAndPersistTrainingPlan(baseInput(), deps);

    expect(callOrder).toEqual(["buildPlanInputSnapshot", "persistGeneratedTrainingPlan"]);
    expect(deps.buildPlanInputSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.persistGeneratedTrainingPlan).toHaveBeenCalledTimes(1);
  });

  it("2a. transmits the snapshot produced by buildPlanInputSnapshot into persistGeneratedTrainingPlan's generation input", async () => {
    const deps = buildDeps();

    await generateAndPersistTrainingPlan(baseInput(), deps);

    const call = (deps.persistGeneratedTrainingPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PersistGeneratedTrainingPlanInput;
    expect(call.generation.planInputSnapshot).toBe(SNAPSHOT);
  });

  it("2b. transmits generationRequestId exactly as received — never replaced, never minted", async () => {
    const deps = buildDeps();

    await generateAndPersistTrainingPlan(baseInput({ generationRequestId: GENERATION_REQUEST_ID }), deps);

    const call = (deps.persistGeneratedTrainingPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PersistGeneratedTrainingPlanInput;
    expect(call.generation.generationRequestId).toBe(GENERATION_REQUEST_ID);
  });

  it("2c. returns persistGeneratedTrainingPlan's result verbatim (generation result -> persistence result)", async () => {
    const deps = buildDeps();

    const result = await generateAndPersistTrainingPlan(baseInput(), deps);

    expect(result).toBe(RESULT);
  });

  it("assembles versionMetadata from existing constants/mappings only — never requested from the caller, never duplicated", async () => {
    const deps = buildDeps();

    await generateAndPersistTrainingPlan(baseInput(), deps);

    const call = (deps.persistGeneratedTrainingPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PersistGeneratedTrainingPlanInput;
    expect(call.versionMetadata.athleteId).toBe(ATHLETE_ID);
    expect(call.versionMetadata.generationTrigger).toBe("initial");
    expect(call.versionMetadata.rationale).toBe("Initial training plan generation.");
    expect(call.versionMetadata.plannerVersion).toBe(call.versionMetadata.rulesetVersion); // V0.5_006 lock: rulesetVersion = plannerVersion
    expect(typeof call.versionMetadata.plannerVersion).toBe("string");
    expect(call.versionMetadata.plannerVersion.length).toBeGreaterThan(0);
    expect(typeof call.versionMetadata.prescriptionSchemaVersion).toBe("string");
    expect(call.versionMetadata.prescriptionSchemaVersion.length).toBeGreaterThan(0);
  });

  it("computes inputSnapshotHash as a real SHA-256 of the exact snapshot JSON — not a placeholder", async () => {
    const deps = buildDeps();

    await generateAndPersistTrainingPlan(baseInput(), deps);

    const call = (deps.persistGeneratedTrainingPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PersistGeneratedTrainingPlanInput;
    const expectedHash = createHash("sha256").update(JSON.stringify(SNAPSHOT)).digest("hex");
    expect(call.versionMetadata.inputSnapshotHash).toBe(expectedHash);
  });

  it("respects an explicit generationTrigger and derives the matching closed-mapping rationale", async () => {
    const deps = buildDeps();

    await generateAndPersistTrainingPlan(baseInput({ generationTrigger: "race_added" }), deps);

    const call = (deps.persistGeneratedTrainingPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0] as PersistGeneratedTrainingPlanInput;
    expect(call.versionMetadata.generationTrigger).toBe("race_added");
    expect(call.versionMetadata.rationale).toBe("Regenerated after a race was added to the calendar.");
  });

  it("3. propagates a buildPlanInputSnapshot failure unchanged, and never calls persistGeneratedTrainingPlan", async () => {
    const blockedError = new Error("GenerationBlockedError: missing_availability");
    const deps = buildDeps({ buildPlanInputSnapshot: vi.fn<typeof buildPlanInputSnapshot>(async () => { throw blockedError; }) });

    await expect(generateAndPersistTrainingPlan(baseInput(), deps)).rejects.toBe(blockedError);
    expect(deps.persistGeneratedTrainingPlan).not.toHaveBeenCalled();
  });

  // 4/5. From this layer, a runGenerationEngine failure and an RPC/persistence
  // failure are both observed identically — as persistGeneratedTrainingPlan
  // rejecting (see this file's module doc for why runGenerationEngine is not
  // a separately-injectable dependency here). Both scenarios are exercised
  // explicitly below with distinctly-shaped errors, never silently swallowed.
  it("4. propagates a generation-stage failure (persistGeneratedTrainingPlan rejecting) unchanged, no silent recovery", async () => {
    const generationError = new Error("PendingProductDecisionError: repScheme");
    const deps = buildDeps({
      persistGeneratedTrainingPlan: vi.fn<typeof persistGeneratedTrainingPlan>(async () => { throw generationError; }),
    });

    await expect(generateAndPersistTrainingPlan(baseInput(), deps)).rejects.toBe(generationError);
  });

  it("5. propagates an RPC/persistence-stage failure unchanged, no silent recovery", async () => {
    const rpcError = new Error("GenerateTrainingPlanVersionRpcError: connection reset");
    const deps = buildDeps({
      persistGeneratedTrainingPlan: vi.fn<typeof persistGeneratedTrainingPlan>(async () => { throw rpcError; }),
    });

    await expect(generateAndPersistTrainingPlan(baseInput(), deps)).rejects.toBe(rpcError);
  });
});
