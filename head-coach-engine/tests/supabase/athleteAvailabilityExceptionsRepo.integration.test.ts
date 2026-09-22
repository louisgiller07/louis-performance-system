/**
 * V0.4_101 — real local Supabase proof for
 * athleteAvailabilityExceptionsRepo.ts: a real round-trip against
 * `athlete_availability_exceptions` through the actual `@supabase/supabase-js`
 * client (never mocked), including the real
 * `upsert(..., { onConflict: "athlete_id,date" })` call against the table's
 * real `unique (athlete_id, date)` constraint — the one thing the mocked
 * unit tests cannot verify.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestClient, createTestAthlete, deleteTestAthlete, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, type TestAthlete } from "./testDb.js";
import { getAvailabilityExceptionsFor, upsertAvailabilityException } from "../../src/supabase/repositories/athleteAvailabilityExceptionsRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

describe.skipIf(!INTEGRATION_ENABLED)("V0.4_101 — athleteAvailabilityExceptionsRepo (real local Supabase)", () => {
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

  it("an athlete with no exceptions declared resolves to an empty array, never an error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 no exceptions");

    const result = await getAvailabilityExceptionsFor(admin, athleteA.athleteId);

    expect(result).toEqual([]);
  });

  it("re-declaring the same date REPLACES the row (real unique(athlete_id, date) conflict target), never a duplicate-key error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 exception re-upsert");

    await upsertAvailabilityException(admin, athleteA.athleteId, { date: "2026-10-03", available: false, note: "travel" });
    await upsertAvailabilityException(admin, athleteA.athleteId, { date: "2026-10-03", available: true, note: "plans changed" });

    const result = await getAvailabilityExceptionsFor(admin, athleteA.athleteId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: "2026-10-03", available: true, note: "plans changed" });
  });

  it("athlete isolation: A's exceptions never leak into B's read", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 exception isolation A");
    athleteB = await createTestAthlete(admin, "V0.4_101 exception isolation B");
    await upsertAvailabilityException(admin, athleteA.athleteId, { date: "2026-10-03", available: false });
    await upsertAvailabilityException(admin, athleteB.athleteId, { date: "2026-10-10", available: false });

    const resultA = await getAvailabilityExceptionsFor(admin, athleteA.athleteId);
    const resultB = await getAvailabilityExceptionsFor(admin, athleteB.athleteId);

    expect(resultA).toHaveLength(1);
    expect(resultA[0]?.date).toBe("2026-10-03");
    expect(resultB).toHaveLength(1);
    expect(resultB[0]?.date).toBe("2026-10-10");
  });
});
