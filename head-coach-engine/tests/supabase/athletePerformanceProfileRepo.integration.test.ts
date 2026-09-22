/**
 * V0.4_101 — real local Supabase proof for athletePerformanceProfileRepo.ts:
 * a real round-trip against `athlete_performance_profiles` through the
 * actual `@supabase/supabase-js` client (never mocked), including the real
 * `upsert(..., { onConflict: "athlete_id" })` call against the table's real
 * PRIMARY KEY — the one thing the mocked unit tests cannot verify.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestClient, createTestAthlete, deleteTestAthlete, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, type TestAthlete } from "./testDb.js";
import { getPerformanceProfileFor, upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

describe.skipIf(!INTEGRATION_ENABLED)("V0.4_101 — athletePerformanceProfileRepo (real local Supabase)", () => {
  let admin: SupabaseClient;
  let athleteA: TestAthlete;
  let athleteB: TestAthlete;

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    if (athleteA) await deleteTestAthlete(admin, athleteA);
    if (athleteB) await deleteTestAthlete(admin, athleteB);
  });

  it("an athlete with no profile configured resolves to null, never an error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 no profile");

    const result = await getPerformanceProfileFor(admin, athleteA.athleteId);

    expect(result).toBeNull();
  });

  it("upsert then read round-trips every field exactly", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 full profile");

    await upsertPerformanceProfileFor(admin, athleteA.athleteId, {
      equipment: ["DH bike", "trail bike"],
      terrain_access: ["bike park"],
      strength_experience_tier: "intermediate",
      declared_limitations: ["left knee"],
      season_objective: "Podium at nationals",
      technical_priorities: { strengths: ["cornering"], weaknesses: ["braking"], priorityAreas: ["braking"] },
    });

    const result = await getPerformanceProfileFor(admin, athleteA.athleteId);

    expect(result).toEqual({
      equipment: ["DH bike", "trail bike"],
      terrain_access: ["bike park"],
      strength_experience_tier: "intermediate",
      declared_limitations: ["left knee"],
      season_objective: "Podium at nationals",
      technical_priorities: { strengths: ["cornering"], weaknesses: ["braking"], priorityAreas: ["braking"] },
    });
  });

  it("a second upsert updates the same row (real PK conflict target), never a duplicate-key error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 re-upsert");

    await upsertPerformanceProfileFor(admin, athleteA.athleteId, { season_objective: "First objective" });
    await upsertPerformanceProfileFor(admin, athleteA.athleteId, { season_objective: "Revised objective" });

    const result = await getPerformanceProfileFor(admin, athleteA.athleteId);

    expect(result?.season_objective).toBe("Revised objective");
  });

  it("athlete isolation: A's profile never leaks into B's read", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 isolation A");
    athleteB = await createTestAthlete(admin, "V0.4_101 isolation B");
    await upsertPerformanceProfileFor(admin, athleteA.athleteId, { season_objective: "Objective A" });
    await upsertPerformanceProfileFor(admin, athleteB.athleteId, { season_objective: "Objective B" });

    const resultA = await getPerformanceProfileFor(admin, athleteA.athleteId);
    const resultB = await getPerformanceProfileFor(admin, athleteB.athleteId);

    expect(resultA?.season_objective).toBe("Objective A");
    expect(resultB?.season_objective).toBe("Objective B");
  });
});
