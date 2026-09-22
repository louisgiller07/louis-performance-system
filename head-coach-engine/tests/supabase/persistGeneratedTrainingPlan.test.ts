import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationEngineInput, GenerationEngineResult } from "../../src/generation/generationEngine.js";
import * as generationEngineModule from "../../src/generation/generationEngine.js";
import type { GenerateTrainingPlanVersionPayload, VersionPersistenceContext } from "../../src/supabase/mapping/generationResultToPersistencePayload.js";
import * as mapperModule from "../../src/supabase/mapping/generationResultToPersistencePayload.js";
import type { GenerateTrainingPlanVersionResult } from "../../src/supabase/rpc/generateTrainingPlanVersionRpc.js";
import * as rpcModule from "../../src/supabase/rpc/generateTrainingPlanVersionRpc.js";
import { persistGeneratedTrainingPlan, type PersistGeneratedTrainingPlanInput } from "../../src/supabase/persistGeneratedTrainingPlan.js";

const FAKE_CLIENT = {} as PersistGeneratedTrainingPlanInput["client"];

const GENERATION_INPUT: GenerationEngineInput = {
  block: { sequenceNumber: 1, name: "Test block", mode: "IN_SEASON", primaryFocus: "test", startDate: "2026-10-19", endDate: "2026-10-25" },
  planInputSnapshot: {
    discipline: "Downhill",
    races: [],
    availability: { windows: [], exceptions: [] },
    equipment: [],
    terrainAccess: [],
    strengthExperienceTier: "beginner",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: [] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  },
};

const VERSION_METADATA: PersistGeneratedTrainingPlanInput["versionMetadata"] = {
  athleteId: "athlete-1",
  plannerVersion: "v1",
  rulesetVersion: "v1",
  prescriptionSchemaVersion: "v1",
  generationTrigger: "initial",
  rationale: "Initial development block.",
  inputSnapshotSchemaVersion: "v1",
  inputSnapshotHash: "hash-1",
};

const FAKE_GENERATION_RESULT: GenerationEngineResult = {
  context: { planVersionId: "version-1", generationRequestId: "request-1", blockId: "block-1" },
  weeks: [],
};

const FAKE_PAYLOAD: GenerateTrainingPlanVersionPayload = {
  athleteId: "athlete-1",
  generationRequestId: "request-1",
  version: {
    id: "version-1",
    horizonStartDate: "2026-10-19",
    horizonEndDate: "2026-10-25",
    inputSnapshot: GENERATION_INPUT.planInputSnapshot,
    inputSnapshotSchemaVersion: "v1",
    inputSnapshotHash: "hash-1",
    plannerVersion: "v1",
    rulesetVersion: "v1",
    catalogVersion: "v2",
    prescriptionSchemaVersion: "v1",
    generationTrigger: "initial",
    rationale: "Initial development block.",
    relaxedConstraints: [],
  },
  blocks: [],
  weeks: [],
  sessions: [],
  plannedPrescriptions: [],
};

const FAKE_RPC_RESULT: GenerateTrainingPlanVersionResult = { planVersionId: "version-1", idempotentReplay: false };

function input(overrides: Partial<PersistGeneratedTrainingPlanInput> = {}): PersistGeneratedTrainingPlanInput {
  return {
    client: FAKE_CLIENT,
    generation: GENERATION_INPUT,
    versionMetadata: VERSION_METADATA,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistGeneratedTrainingPlan — full flow order", () => {
  it("calls runGenerationEngine, then the mapper, then the RPC wrapper, in that exact order", async () => {
    const order: string[] = [];
    vi.spyOn(generationEngineModule, "runGenerationEngine").mockImplementation(() => {
      order.push("generationEngine");
      return FAKE_GENERATION_RESULT;
    });
    vi.spyOn(mapperModule, "generationResultToPersistencePayload").mockImplementation(() => {
      order.push("mapper");
      return FAKE_PAYLOAD;
    });
    vi.spyOn(rpcModule, "generateTrainingPlanVersionRpc").mockImplementation(async () => {
      order.push("rpc");
      return FAKE_RPC_RESULT;
    });

    await persistGeneratedTrainingPlan(input());

    expect(order).toEqual(["generationEngine", "mapper", "rpc"]);
  });
});

describe("persistGeneratedTrainingPlan — data passed between steps", () => {
  it("passes runGenerationEngine's exact result into the mapper, alongside block and derived context", async () => {
    vi.spyOn(generationEngineModule, "runGenerationEngine").mockReturnValue(FAKE_GENERATION_RESULT);
    const mapperSpy = vi.spyOn(mapperModule, "generationResultToPersistencePayload").mockReturnValue(FAKE_PAYLOAD);
    vi.spyOn(rpcModule, "generateTrainingPlanVersionRpc").mockResolvedValue(FAKE_RPC_RESULT);

    await persistGeneratedTrainingPlan(input());

    expect(mapperSpy).toHaveBeenCalledTimes(1);
    const [passedResult, passedBlock, passedContext] = mapperSpy.mock.calls[0]! as [GenerationEngineResult, GenerationEngineInput["block"], VersionPersistenceContext];
    expect(passedResult).toBe(FAKE_GENERATION_RESULT);
    expect(passedBlock).toBe(GENERATION_INPUT.block);
    expect(passedContext).toEqual({ ...VERSION_METADATA, inputSnapshot: GENERATION_INPUT.planInputSnapshot });
  });

  it("passes the mapper's exact payload into the RPC wrapper, unchanged", async () => {
    vi.spyOn(generationEngineModule, "runGenerationEngine").mockReturnValue(FAKE_GENERATION_RESULT);
    vi.spyOn(mapperModule, "generationResultToPersistencePayload").mockReturnValue(FAKE_PAYLOAD);
    const rpcSpy = vi.spyOn(rpcModule, "generateTrainingPlanVersionRpc").mockResolvedValue(FAKE_RPC_RESULT);

    await persistGeneratedTrainingPlan(input());

    expect(rpcSpy).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_PAYLOAD);
  });
});

describe("persistGeneratedTrainingPlan — RPC result returned", () => {
  it("returns exactly what the RPC wrapper resolves with", async () => {
    vi.spyOn(generationEngineModule, "runGenerationEngine").mockReturnValue(FAKE_GENERATION_RESULT);
    vi.spyOn(mapperModule, "generationResultToPersistencePayload").mockReturnValue(FAKE_PAYLOAD);
    vi.spyOn(rpcModule, "generateTrainingPlanVersionRpc").mockResolvedValue({ planVersionId: "xxx", idempotentReplay: false });

    const result = await persistGeneratedTrainingPlan(input());

    expect(result).toEqual({ planVersionId: "xxx", idempotentReplay: false });
  });
});

describe("persistGeneratedTrainingPlan — generation failure", () => {
  it("stops immediately: mapper and RPC are never called, the error propagates", async () => {
    const generationError = new Error("no compatible exercise for movement category");
    vi.spyOn(generationEngineModule, "runGenerationEngine").mockImplementation(() => {
      throw generationError;
    });
    const mapperSpy = vi.spyOn(mapperModule, "generationResultToPersistencePayload");
    const rpcSpy = vi.spyOn(rpcModule, "generateTrainingPlanVersionRpc");

    await expect(persistGeneratedTrainingPlan(input())).rejects.toThrow(generationError);
    expect(mapperSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("persistGeneratedTrainingPlan — RPC failure", () => {
  it("propagates the RPC error with no fallback", async () => {
    vi.spyOn(generationEngineModule, "runGenerationEngine").mockReturnValue(FAKE_GENERATION_RESULT);
    vi.spyOn(mapperModule, "generationResultToPersistencePayload").mockReturnValue(FAKE_PAYLOAD);
    const rpcError = new Error("generate_training_plan_version RPC call failed: connection reset");
    vi.spyOn(rpcModule, "generateTrainingPlanVersionRpc").mockRejectedValue(rpcError);

    await expect(persistGeneratedTrainingPlan(input())).rejects.toThrow(rpcError);
  });
});

describe("persistGeneratedTrainingPlan — boundary", () => {
  it("the source file never contains @supabase, .rpc(, randomUUID, crypto, or Date.now", () => {
    const sourcePath = fileURLToPath(new URL("../../src/supabase/persistGeneratedTrainingPlan.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("@supabase");
    expect(code).not.toContain(".rpc(");
    expect(code).not.toMatch(/randomUUID\s*\(/);
    expect(code).not.toContain("crypto");
    expect(code).not.toContain("Date.now(");
  });
});
