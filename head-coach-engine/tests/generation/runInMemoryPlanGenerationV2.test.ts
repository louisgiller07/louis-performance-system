import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanInputSnapshotV2 } from "planning-engine/session-model-v2";
import { DEFAULT_PLANNING_MODEL, runInMemoryPlanGenerationV2 } from "../../src/generation/v2/runInMemoryPlanGenerationV2.js";

// UX-11A.5b.5a — explicit in-memory V2 entry point (no persistence).

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

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("runInMemoryPlanGenerationV2", () => {
  it("V1 stays the default planning model", () => {
    expect(DEFAULT_PLANNING_MODEL).toBe("v1");
  });

  it("builds the snapshot once over the plan horizon, then generates a complete V2 plan in memory", async () => {
    const buildPlanInputSnapshotV2 = vi.fn(async () => SNAPSHOT);
    const result = await runInMemoryPlanGenerationV2(
      { planningModel: "v2", client: {} as SupabaseClient, athleteId: "a1", today: "2026-10-05", durationWeeks: 2 },
      { buildPlanInputSnapshotV2, mintId: counter() }
    );
    expect(buildPlanInputSnapshotV2).toHaveBeenCalledTimes(1);
    expect(buildPlanInputSnapshotV2).toHaveBeenCalledWith(expect.anything(), "a1", "2026-10-05", { startDate: "2026-10-05", endDate: "2026-10-18" });
    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    const sessions = result.plan.weeks.flatMap((w) => w.sessions);
    expect(sessions.length).toBe(10);
    expect(sessions.every((s) => s.plannedPrescription.schemaVersion === "v2")).toBe(true);
    expect(result.plan).toMatchObject({ planningModel: "v2", inputSnapshotSchemaVersion: "v2", prescriptionSchemaVersion: "v2", catalogVersion: "session-model-v2.6" });
  });

  it("returns the locked block instead of a plan when DH data is missing", async () => {
    const result = await runInMemoryPlanGenerationV2(
      { planningModel: "v2", client: {} as SupabaseClient, athleteId: "a1", today: "2026-10-05", durationWeeks: 2 },
      { buildPlanInputSnapshotV2: vi.fn(async () => ({ ...SNAPSHOT, dhTechnicalTier: null })), mintId: counter() }
    );
    expect(result).toEqual({ status: "blocked", code: "missing_dh_technical_tier", detail: {} });
  });

  it("refuses to run without an explicit planningModel v2", async () => {
    await expect(
      runInMemoryPlanGenerationV2({ planningModel: "v1" as never, client: {} as SupabaseClient, athleteId: "a1", today: "2026-10-05", durationWeeks: 2 }, { buildPlanInputSnapshotV2: vi.fn(), mintId: counter() })
    ).rejects.toThrow(/planningModel "v2"/);
  });
});
