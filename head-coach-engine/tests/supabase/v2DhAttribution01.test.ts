import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshotV2 } from "planning-engine/session-model-v2";
import { generateTrainingPlanForAthlete, type GenerateTrainingPlanForAthleteDeps } from "../../src/generation/generateTrainingPlanForAthlete.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import type { GenerateTrainingPlanVersionPayloadV2 } from "../../src/generation/v2/planV2PersistencePayload.js";

// V2-DH-ATTRIBUTION-01 (HPM 2026-10-26) — the V2 production path never raises a block's start from a declared recent
// volume (`recentVolume: "not_evidence"`, passed with the DH unit requirement); without the option (direct callers,
// V2 OFF), the previous plans exactly.

const snapshot = (trailingVolumeMinutes: number): PlanInputSnapshotV2 => ({
  discipline: "Downhill",
  races: [],
  availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes },
  dhTechnicalTier: "intermediate",
});

describe("V2-DH-ATTRIBUTION-01 · the V2 production path", () => {
  it("passes both protections to every V2 generation; V2 off never reaches it", async () => {
    const fake = (assignment: "v1" | "v2") => ({
      getPlanningModelAssignment: vi.fn(async () => assignment),
      generateAndPersistTrainingPlan: vi.fn(async () => ({ planVersionId: "v1-plan", idempotentReplay: false })) as unknown as GenerateTrainingPlanForAthleteDeps["generateAndPersistTrainingPlan"],
      generateAndPersistTrainingPlanV2: vi.fn(async () => ({ status: "persisted" as const, planVersionId: "v2-plan", idempotentReplay: false, plan: {} as never })),
    });
    const input = (globalV2Enabled: boolean) => ({ client: {} as never, athleteId: "a", generationRequestId: "r", durationWeeks: 2, today: "2026-10-05", globalV2Enabled });
    const on = fake("v2");
    await generateTrainingPlanForAthlete(input(true), on);
    expect(on.generateAndPersistTrainingPlanV2).toHaveBeenCalledWith(expect.objectContaining({ dhUnit: "required", recentVolume: "not_evidence" }));
    const off = fake("v2");
    await generateTrainingPlanForAthlete(input(false), off);
    expect(off.generateAndPersistTrainingPlanV2).not.toHaveBeenCalled();
  });

  it("a declared recent volume of 600 min: the persisted weeks are those of a rider without volume (introduction first); without the option, the previous plan (build first)", async () => {
    const weeksFor = async (trailing: number, recentVolume?: "not_evidence") => {
      let payload: GenerateTrainingPlanVersionPayloadV2 | null = null;
      let n = 0;
      const deps = {
        buildPlanInputSnapshotV2: vi.fn(async () => snapshot(trailing)),
        callRpc: vi.fn(async (_c: SupabaseClient, p: GenerateTrainingPlanVersionPayloadV2) => ((payload = p), { planVersionId: "p", idempotentReplay: false })),
        mintId: () => `30000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      };
      await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: {} as SupabaseClient, athleteId: "a", generationRequestId: "r", durationWeeks: 4, today: "2026-11-01", ...(recentVolume ? { recentVolume } : {}) }, deps);
      return (payload as unknown as { weeks: { doseSummary: { progression?: { role: string } } }[]; sessions: unknown[] }).weeks.map((w) => w.doseSummary.progression?.role);
    };
    expect(await weeksFor(600, "not_evidence")).toEqual(await weeksFor(0, "not_evidence"));
    expect((await weeksFor(600, "not_evidence"))[0]).toBe("introduction");
    expect((await weeksFor(600))[0]).toBe("build");
  });
});
