import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePlanV2InMemory, type PlanInputSnapshotV2, type PlanV2InMemory } from "planning-engine/session-model-v2";
import { assertPlanV2Invariants, planV2ToPersistencePayload, PlanV2InvariantError } from "../../src/generation/v2/planV2PersistencePayload.js";
import { generateAndPersistTrainingPlanV2, hashPlanInputSnapshotV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

// UX-11A.5b.5b — V2 persistence mapper and no-partial-write orchestration (RPC mocked here;
// the real local-DB behaviour is in tests/supabase/v2Persistence.integration.test.ts).

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
};
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" };

function counter() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function plan(): PlanV2InMemory {
  const result = generatePlanV2InMemory({ block: BLOCK, snapshot: SNAPSHOT, mintId: counter() });
  if (result.status !== "generated") throw new Error("expected a generated plan");
  return result.plan;
}

const CONTEXT = { athleteId: "athlete-1", generationRequestId: "req-1", snapshot: SNAPSHOT, inputSnapshotHash: "hash", generationTrigger: "initial" as const, rationale: "Initial training plan generation." };

describe("planV2ToPersistencePayload — transformation only", () => {
  it("version: v2 schemas, Session Model catalogue, real planner version, the V2 snapshot, relaxations", () => {
    const p = plan();
    const payload = planV2ToPersistencePayload(p, CONTEXT);
    expect(payload.version).toEqual({
      id: p.planVersionId,
      horizonStartDate: "2026-10-05",
      horizonEndDate: "2026-10-18",
      inputSnapshot: SNAPSHOT,
      inputSnapshotSchemaVersion: "v2",
      inputSnapshotHash: "hash",
      plannerVersion: "v2",
      rulesetVersion: "v2",
      catalogVersion: "session-model-v2.6",
      prescriptionSchemaVersion: "v2",
      generationTrigger: "initial",
      rationale: "Initial training plan generation.",
      relaxedConstraints: [],
    });
    expect(payload.blocks).toEqual([{ id: p.blockId, ...BLOCK }]);
  });

  it("one v2 prescription per session, same ids as the validated document (no id regenerated)", () => {
    const p = plan();
    const payload = planV2ToPersistencePayload(p, CONTEXT);
    const sessions = p.weeks.flatMap((w) => w.sessions);
    expect(payload.sessions.map((s) => s.id)).toEqual(sessions.map((s) => s.generatedPlanSessionId));
    expect(payload.plannedPrescriptions.map((x) => x.generatedPlanSessionId)).toEqual(sessions.map((s) => s.generatedPlanSessionId));
    expect(payload.plannedPrescriptions.map((x) => x.structure)).toEqual(sessions.map((s) => s.plannedPrescription.structure));
    expect(new Set(payload.plannedPrescriptions.map((x) => x.schemaVersion))).toEqual(new Set(["v2"]));
    expect(new Set(payload.plannedPrescriptions.map((x) => x.catalogVersion))).toEqual(new Set(["session-model-v2.6"]));
  });

  it("legacy doseTarget is transported on sessions as compatibility metadata only, never inside a prescription", () => {
    const payload = planV2ToPersistencePayload(plan(), CONTEXT);
    const strength = payload.sessions.find((s) => s.kind === "STRENGTH_LOWER")!;
    expect(strength.doseTarget).toMatchObject({ domain: "strength" });
    expect(JSON.stringify(payload.plannedPrescriptions)).not.toMatch(/setVolume|targetRpeOrRir|intensityZone|focusedRunsCount/);
  });

  it.each<[string, (p: any) => void]>([
    ["a session without prescription", (p) => delete p.weeks[0].sessions[0].plannedPrescription],
    ["a duplicate session id", (p) => (p.weeks[0].sessions[1].generatedPlanSessionId = p.weeks[0].sessions[0].generatedPlanSessionId)],
    ["a duplicate prescription id", (p) => (p.weeks[0].sessions[1].plannedPrescription.id = p.weeks[0].sessions[0].plannedPrescription.id)],
    ["a v1 prescription", (p) => (p.weeks[0].sessions[0].plannedPrescription.schemaVersion = "v1")],
    ["an invalid structure", (p) => (p.weeks[0].sessions[0].plannedPrescription.structure.schemaVersion = "v1")],
    ["a prescription of another kind", (p) => (p.weeks[0].sessions[0].plannedPrescription.structure.sessionKind = "AEROBIC_BASE")],
    ["a load-variable session without load profile (DB check mirror)", (p) => delete p.weeks[0].sessions.find((s: any) => s.kind === "DH_TECHNICAL").loadProfile],
  ])("refuses %s before any payload", (_label, mutate) => {
    const p = JSON.parse(JSON.stringify(plan()));
    mutate(p);
    expect(() => assertPlanV2Invariants(p)).toThrow(PlanV2InvariantError);
    expect(() => planV2ToPersistencePayload(p, CONTEXT)).toThrow(PlanV2InvariantError);
  });
});

describe("generateAndPersistTrainingPlanV2 — no partial write", () => {
  const input = { planningModel: "v2" as const, client: {} as SupabaseClient, athleteId: "athlete-1", generationRequestId: "req-1", durationWeeks: 2, today: "2026-10-05" };

  it("one RPC call with the full payload; the snapshot hash is the V1 technique applied to the V2 snapshot", async () => {
    const callRpc = vi.fn(async () => ({ planVersionId: "v-1", idempotentReplay: false }));
    const result = await generateAndPersistTrainingPlanV2(input, { buildPlanInputSnapshotV2: vi.fn(async () => SNAPSHOT), callRpc, mintId: counter() });
    expect(result).toMatchObject({ status: "persisted", planVersionId: "v-1", idempotentReplay: false });
    expect(callRpc).toHaveBeenCalledTimes(1);
    const payload = (callRpc.mock.calls[0] as unknown as [unknown, { version: { inputSnapshotHash: string } }])[1];
    expect(payload.version.inputSnapshotHash).toBe(hashPlanInputSnapshotV2(SNAPSHOT));
  });

  it("a blocked plan never reaches the RPC", async () => {
    const callRpc = vi.fn();
    const result = await generateAndPersistTrainingPlanV2(input, { buildPlanInputSnapshotV2: vi.fn(async () => ({ ...SNAPSHOT, dhTechnicalTier: null })), callRpc, mintId: counter() });
    expect(result).toEqual({ status: "blocked", code: "missing_dh_technical_tier", detail: {} });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("requires an explicit planningModel v2", async () => {
    await expect(generateAndPersistTrainingPlanV2({ ...input, planningModel: "v1" as never }, { buildPlanInputSnapshotV2: vi.fn(), callRpc: vi.fn(), mintId: counter() })).rejects.toThrow(/planningModel "v2"/);
  });
});
