/**
 * V0.3_008C — unit coverage for getAthleteCoachingContext's normalization
 * logic (mocked SupabaseClient, no network) — missing/partial onboarding
 * data, the legacy athletes.discipline default, and error propagation.
 * See athleteCoachingContextRepo.integration.test.ts for the real-DB
 * cross-athlete isolation proof.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAthleteCoachingContext } from "../../src/supabase/repositories/athleteCoachingContextRepo.js";

interface MockResult {
  data: unknown;
  error: { message: string } | null;
}

/** Builds a minimal mock client where `.from(table)` resolves to `byTable[table]` for a `.select().eq().maybeSingle()` chain. */
function mockClient(byTable: Record<string, MockResult>): SupabaseClient {
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue(byTable[table] ?? { data: null, error: null }),
      })),
    })),
  }));
  return { from } as unknown as SupabaseClient;
}

describe("getAthleteCoachingContext", () => {
  it("returns a fully-populated context when discipline and onboarding are both complete", async () => {
    const client = mockClient({
      athletes: { data: { discipline: "Downhill" }, error: null },
      athlete_onboarding_profiles: {
        data: {
          competition_level: "World Cup",
          primary_goal: "Race performance",
          weekly_training_hours: "10-15h",
          preferred_riding_days: ["Saturday", "Sunday"],
        },
        error: null,
      },
    });

    const context = await getAthleteCoachingContext(client, "athlete-1");

    expect(context).toEqual({
      athlete_id: "athlete-1",
      discipline: "Downhill",
      competition_level: "World Cup",
      primary_goal: "Race performance",
      weekly_training_hours: "10-15h",
      preferred_riding_days: ["Saturday", "Sunday"],
    });
  });

  it("a brand new athlete (no onboarding row, legacy discipline default) resolves to just athlete_id — never a fabricated value, never an error", async () => {
    const client = mockClient({
      athletes: { data: { discipline: "DH_MTB" }, error: null },
      athlete_onboarding_profiles: { data: null, error: null },
    });

    const context = await getAthleteCoachingContext(client, "athlete-2");

    expect(context).toEqual({ athlete_id: "athlete-2" });
  });

  it("partial onboarding data: only the answered fields are present", async () => {
    const client = mockClient({
      athletes: { data: { discipline: "DH_MTB" }, error: null },
      athlete_onboarding_profiles: {
        data: {
          competition_level: "Beginner",
          primary_goal: null,
          weekly_training_hours: null,
          preferred_riding_days: [],
        },
        error: null,
      },
    });

    const context = await getAthleteCoachingContext(client, "athlete-3");

    expect(context).toEqual({ athlete_id: "athlete-3", competition_level: "Beginner" });
  });

  it("an empty preferred_riding_days array is treated as not-yet-answered, not an empty selection", async () => {
    const client = mockClient({
      athletes: { data: { discipline: "Enduro" }, error: null },
      athlete_onboarding_profiles: {
        data: {
          competition_level: "Amateur racer",
          primary_goal: "Fitness",
          weekly_training_hours: "5-10h",
          preferred_riding_days: [],
        },
        error: null,
      },
    });

    const context = await getAthleteCoachingContext(client, "athlete-4");

    expect(context.preferred_riding_days).toBeUndefined();
  });

  it("an unrecognized discipline value (e.g. a stale/legacy string) is never surfaced as if declared", async () => {
    const client = mockClient({
      athletes: { data: { discipline: "some-legacy-value" }, error: null },
      athlete_onboarding_profiles: { data: null, error: null },
    });

    const context = await getAthleteCoachingContext(client, "athlete-5");

    expect(context.discipline).toBeUndefined();
  });

  it("propagates a Supabase error on the athletes read instead of silently returning a partial context", async () => {
    const client = mockClient({
      athletes: { data: null, error: { message: "connection reset" } },
      athlete_onboarding_profiles: { data: null, error: null },
    });

    await expect(getAthleteCoachingContext(client, "athlete-6")).rejects.toThrow(/athletes/);
  });

  it("propagates a Supabase error on the onboarding-profile read", async () => {
    const client = mockClient({
      athletes: { data: { discipline: "Downhill" }, error: null },
      athlete_onboarding_profiles: { data: null, error: { message: "timeout" } },
    });

    await expect(getAthleteCoachingContext(client, "athlete-7")).rejects.toThrow(/athlete_onboarding_profiles/);
  });
});
