/**
 * V0.4_101 — unit coverage for athletePerformanceProfileRepo.ts (mocked
 * SupabaseClient, no network). See athletePerformanceProfileRepo.
 * integration.test.ts for the real-DB schema/RLS proof.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPerformanceProfileFor,
  upsertPerformanceProfileFor,
  type AthletePerformanceProfileRawRow,
} from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";

interface MockResult {
  data: unknown;
  error: { message: string } | null;
}

function mockReadClient(result: MockResult): { client: SupabaseClient; eq: ReturnType<typeof vi.fn> } {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, eq };
}

function mockWriteClient(result: { error: { message: string } | null }): {
  client: SupabaseClient;
  upsert: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as unknown as SupabaseClient, upsert, from };
}

const FULL_ROW: AthletePerformanceProfileRawRow = {
  equipment: ["DH bike", "trail bike"],
  terrain_access: ["bike park", "natural trails"],
  strength_experience_tier: "intermediate",
  declared_limitations: ["left knee"],
  season_objective: "Podium at nationals",
  technical_priorities: { strengths: ["cornering"], weaknesses: ["braking"], priorityAreas: ["braking"] },
};

describe("getPerformanceProfileFor", () => {
  it("returns the raw row when a profile exists", async () => {
    const { client, eq } = mockReadClient({ data: FULL_ROW, error: null });

    const result = await getPerformanceProfileFor(client, "athlete-1");

    expect(result).toEqual(FULL_ROW);
    expect(eq).toHaveBeenCalledWith("athlete_id", "athlete-1");
  });

  it("returns null when the athlete has never configured a profile — never an error, never a fabricated default", async () => {
    const { client } = mockReadClient({ data: null, error: null });

    const result = await getPerformanceProfileFor(client, "athlete-2");

    expect(result).toBeNull();
  });

  it("propagates a Supabase error instead of silently returning null", async () => {
    const { client } = mockReadClient({ data: null, error: { message: "connection reset" } });

    await expect(getPerformanceProfileFor(client, "athlete-3")).rejects.toThrow(/athlete_performance_profiles/);
  });
});

describe("upsertPerformanceProfileFor", () => {
  it("upserts the merged athlete_id + fields, conflict target athlete_id", async () => {
    const { client, upsert } = mockWriteClient({ error: null });

    await upsertPerformanceProfileFor(client, "athlete-1", { season_objective: "Podium at nationals" });

    expect(upsert).toHaveBeenCalledWith(
      { athlete_id: "athlete-1", season_objective: "Podium at nationals" },
      { onConflict: "athlete_id" }
    );
  });

  it("propagates a Supabase error instead of resolving silently", async () => {
    const { client } = mockWriteClient({ error: { message: "constraint violation" } });

    await expect(upsertPerformanceProfileFor(client, "athlete-1", {})).rejects.toThrow(/athlete_performance_profiles/);
  });
});
