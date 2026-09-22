import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerateTrainingPlanVersionPayload } from "../../../src/supabase/mapping/generationResultToPersistencePayload.js";
import {
  generateTrainingPlanVersionRpc,
  GenerateTrainingPlanVersionRpcError,
  InvalidGenerateTrainingPlanVersionResultError,
} from "../../../src/supabase/rpc/generateTrainingPlanVersionRpc.js";

const PAYLOAD: GenerateTrainingPlanVersionPayload = {
  athleteId: "athlete-1",
  generationRequestId: "request-1",
  version: {
    id: "version-1",
    horizonStartDate: "2026-10-19",
    horizonEndDate: "2026-10-25",
    inputSnapshot: { discipline: "Downhill" } as unknown as GenerateTrainingPlanVersionPayload["version"]["inputSnapshot"],
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
  blocks: [{ id: "block-1", sequenceNumber: 1, name: "Test block", mode: "IN_SEASON", primaryFocus: "test", startDate: "2026-10-19", endDate: "2026-10-25" }],
  weeks: [
    {
      id: "week-1",
      blockId: "block-1",
      weekNumber: 1,
      startDate: "2026-10-19",
      endDate: "2026-10-25",
      weekType: "development",
      doseSummary: {
        plannedStrengthSessionCount: 1,
        plannedDhTechnicalSessionCount: 0,
        plannedAerobicSessionCount: 0,
        plannedRestOrRecoveryDayCount: 6,
        totalPlannedMinutes: 60,
      },
      rationale: "week 1",
    },
  ],
  sessions: [
    {
      id: "session-1",
      weekId: "week-1",
      date: "2026-10-19",
      kind: "STRENGTH_LOWER",
      durationMin: 60,
      doseTarget: { domain: "strength", setVolume: 12, targetRpeOrRir: 7 },
      rationale: "session 1",
    },
  ],
  plannedPrescriptions: [
    {
      id: "prescription-1",
      generatedPlanSessionId: "session-1",
      schemaVersion: "v1",
      catalogVersion: "v2",
      structure: { domain: "strength", schemaVersion: "v1", blocks: [] } as unknown as GenerateTrainingPlanVersionPayload["plannedPrescriptions"][number]["structure"],
    },
  ],
};

function fakeClient(rpcImpl: (name: string, params: unknown) => Promise<{ data: unknown; error: { message: string } | null }>): SupabaseClient {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient;
}

describe("generateTrainingPlanVersionRpc — correct call", () => {
  it("calls client.rpc with 'generate_training_plan_version' and the exact p_* parameters", async () => {
    const rpcMock = vi.fn(async () => ({ data: { plan_version_id: "version-1", idempotent_replay: false }, error: null }));
    const client = { rpc: rpcMock } as unknown as SupabaseClient;

    await generateTrainingPlanVersionRpc(client, PAYLOAD);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("generate_training_plan_version", {
      p_athlete_id: "athlete-1",
      p_generation_request_id: "request-1",
      p_version: PAYLOAD.version,
      p_blocks: PAYLOAD.blocks,
      p_weeks: PAYLOAD.weeks,
      p_sessions: PAYLOAD.sessions,
      p_planned_prescriptions: PAYLOAD.plannedPrescriptions,
    });
  });
});

describe("generateTrainingPlanVersionRpc — payload passthrough, unchanged", () => {
  it("transmits payload.version/blocks/weeks/sessions/plannedPrescriptions by reference, no transformation", async () => {
    let capturedParams: unknown;
    const client = fakeClient(async (_name, params) => {
      capturedParams = params;
      return { data: { plan_version_id: "version-1", idempotent_replay: false }, error: null };
    });

    await generateTrainingPlanVersionRpc(client, PAYLOAD);

    const params = capturedParams as Record<string, unknown>;
    expect(params.p_version).toBe(PAYLOAD.version);
    expect(params.p_blocks).toBe(PAYLOAD.blocks);
    expect(params.p_weeks).toBe(PAYLOAD.weeks);
    expect(params.p_sessions).toBe(PAYLOAD.sessions);
    expect(params.p_planned_prescriptions).toBe(PAYLOAD.plannedPrescriptions);
  });
});

describe("generateTrainingPlanVersionRpc — RPC result returned", () => {
  it("returns exactly the parsed result the RPC provides", async () => {
    const client = fakeClient(async () => ({ data: { plan_version_id: "version-42", idempotent_replay: true }, error: null }));

    const result = await generateTrainingPlanVersionRpc(client, PAYLOAD);

    expect(result).toEqual({ planVersionId: "version-42", idempotentReplay: true });
  });

  it("rejects a malformed result rather than returning a partial/coerced value", async () => {
    const client = fakeClient(async () => ({ data: { plan_version_id: "v1" }, error: null })); // missing idempotent_replay

    await expect(generateTrainingPlanVersionRpc(client, PAYLOAD)).rejects.toThrow(InvalidGenerateTrainingPlanVersionResultError);
  });
});

describe("generateTrainingPlanVersionRpc — error propagation", () => {
  it("throws GenerateTrainingPlanVersionRpcError when the RPC call errors, never swallows it", async () => {
    const client = fakeClient(async () => ({ data: null, error: { message: "generation_request_id already used with a different environment" } }));

    await expect(generateTrainingPlanVersionRpc(client, PAYLOAD)).rejects.toThrow(GenerateTrainingPlanVersionRpcError);
    await expect(generateTrainingPlanVersionRpc(client, PAYLOAD)).rejects.toThrow(/generation_request_id already used/);
  });
});

describe("generateTrainingPlanVersionRpc — no business logic in the wrapper", () => {
  it("the source file never calls randomUUID/crypto.randomUUID/Date.now/Math.random", () => {
    const sourcePath = fileURLToPath(new URL("../../../src/supabase/rpc/generateTrainingPlanVersionRpc.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/randomUUID\s*\(/);
    expect(code).not.toContain("Date.now(");
    expect(code).not.toContain("Math.random(");
  });
});
