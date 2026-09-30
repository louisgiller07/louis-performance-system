/**
 * UX-11A.5a.2b — athlete_performance_profiles.dh_technical_tier on the local
 * Supabase stack: the constraint, the repository read / write, RLS for the
 * rider's own write path, and the guarantee that nothing derives it.
 *
 * Run with RUN_LOCAL_SUPABASE_INTEGRATION=1 and the local stack's keys
 * (see testDb.ts). Local target only.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestAthlete,
  createTestClient,
  deleteTestAthlete,
  getAthleteAuthClient,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { getPerformanceProfileFor, upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!PUBLISHABLE_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

describe.skipIf(!INTEGRATION_ENABLED)("UX-11A.5a.2b — dh_technical_tier (real local Supabase)", () => {
  let admin: SupabaseClient;
  const athletes: TestAthlete[] = [];

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    while (athletes.length > 0) await deleteTestAthlete(admin, athletes.pop()!);
  });

  async function newAthlete(name: string): Promise<TestAthlete> {
    const athlete = await createTestAthlete(admin, name);
    athletes.push(athlete);
    return athlete;
  }

  it("is NULL for a profile written without it (legacy shape), with no default", async () => {
    const a = await newAthlete("UX-11A.5a.2b legacy");
    await upsertPerformanceProfileFor(admin, a.athleteId, { strength_experience_tier: "advanced", technical_priorities: { priorityAreas: ["jumps"] } });
    const row = await getPerformanceProfileFor(admin, a.athleteId);
    expect(row?.dh_technical_tier).toBeNull();
  });

  it("accepts beginner, intermediate and advanced, and a later modification", async () => {
    const a = await newAthlete("UX-11A.5a.2b values");
    for (const tier of ["beginner", "intermediate", "advanced"] as const) {
      await upsertPerformanceProfileFor(admin, a.athleteId, { dh_technical_tier: tier });
      expect((await getPerformanceProfileFor(admin, a.athleteId))?.dh_technical_tier).toBe(tier);
    }
    await upsertPerformanceProfileFor(admin, a.athleteId, { dh_technical_tier: null });
    expect((await getPerformanceProfileFor(admin, a.athleteId))?.dh_technical_tier).toBeNull();
  });

  it("rejects any other value", async () => {
    const a = await newAthlete("UX-11A.5a.2b invalid");
    for (const invalid of ["expert", "Intermediate", "", "national"]) {
      await expect(upsertPerformanceProfileFor(admin, a.athleteId, { dh_technical_tier: invalid }), invalid).rejects.toThrow();
    }
    expect(await getPerformanceProfileFor(admin, a.athleteId)).toBeNull();
  });

  it("is never derived from the strength tier or the competition level", async () => {
    const a = await newAthlete("UX-11A.5a.2b no inference");
    await admin.from("athlete_onboarding_profiles").upsert({ athlete_id: a.athleteId, competition_level: "World Cup" }, { onConflict: "athlete_id" });
    await upsertPerformanceProfileFor(admin, a.athleteId, { strength_experience_tier: "advanced" });
    const row = await getPerformanceProfileFor(admin, a.athleteId);
    expect(row?.strength_experience_tier).toBe("advanced");
    expect(row?.dh_technical_tier).toBeNull();
  });

  it("changing the tier leaves every other profile column untouched", async () => {
    const a = await newAthlete("UX-11A.5a.2b isolation");
    const priorities = { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering"], extra: "kept" };
    await upsertPerformanceProfileFor(admin, a.athleteId, { strength_experience_tier: "beginner", technical_priorities: priorities, equipment: ["dumbbells"] });
    await upsertPerformanceProfileFor(admin, a.athleteId, { dh_technical_tier: "intermediate" });
    const row = await getPerformanceProfileFor(admin, a.athleteId);
    expect(row).toMatchObject({ strength_experience_tier: "beginner", technical_priorities: priorities, equipment: ["dumbbells"], dh_technical_tier: "intermediate" });
  });

  it("RLS: the rider can set their own tier through their own client, never another rider's", async () => {
    const a = await newAthlete("UX-11A.5a.2b rider A");
    const b = await newAthlete("UX-11A.5a.2b rider B");
    const riderA = await getAthleteAuthClient(a.athleteId);

    const own = await riderA.from("athlete_performance_profiles").upsert({ athlete_id: a.athleteId, dh_technical_tier: "advanced" }, { onConflict: "athlete_id" });
    expect(own.error).toBeNull();
    expect((await getPerformanceProfileFor(admin, a.athleteId))?.dh_technical_tier).toBe("advanced");

    const other = await riderA.from("athlete_performance_profiles").upsert({ athlete_id: b.athleteId, dh_technical_tier: "advanced" }, { onConflict: "athlete_id" });
    expect(other.error).not.toBeNull();
    expect(await getPerformanceProfileFor(admin, b.athleteId)).toBeNull();
  });
});
