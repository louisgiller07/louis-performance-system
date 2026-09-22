/**
 * V0.4_101 — real local Supabase proof for athleteLockedDatesRepo.ts: a real
 * round-trip against `athlete_locked_dates` through the actual
 * `@supabase/supabase-js` client (never mocked), including the real
 * `upsert(..., { onConflict: "athlete_id,date" })` call against the table's
 * real `unique (athlete_id, date)` constraint — the one thing the mocked
 * unit tests cannot verify.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestClient, createTestAthlete, deleteTestAthlete, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, type TestAthlete } from "./testDb.js";
import { getLockedDatesFor, upsertLockedDate } from "../../src/supabase/repositories/athleteLockedDatesRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

describe.skipIf(!INTEGRATION_ENABLED)("V0.4_101 — athleteLockedDatesRepo (real local Supabase)", () => {
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

  it("an athlete with no locked dates declared resolves to an empty array, never an error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 no locked dates");

    const result = await getLockedDatesFor(admin, athleteA.athleteId);

    expect(result).toEqual([]);
  });

  it("re-declaring the same date REPLACES the row (real unique(athlete_id, date) conflict target), never a duplicate-key error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 locked date re-upsert");

    await upsertLockedDate(admin, athleteA.athleteId, { date: "2026-11-01", reason: "initial reason" });
    await upsertLockedDate(admin, athleteA.athleteId, { date: "2026-11-01", reason: "revised reason" });

    const result = await getLockedDatesFor(admin, athleteA.athleteId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: "2026-11-01", reason: "revised reason" });
  });

  it("athlete isolation: A's locked dates never leak into B's read", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 locked date isolation A");
    athleteB = await createTestAthlete(admin, "V0.4_101 locked date isolation B");
    await upsertLockedDate(admin, athleteA.athleteId, { date: "2026-11-01" });
    await upsertLockedDate(admin, athleteB.athleteId, { date: "2026-11-08" });

    const resultA = await getLockedDatesFor(admin, athleteA.athleteId);
    const resultB = await getLockedDatesFor(admin, athleteB.athleteId);

    expect(resultA).toHaveLength(1);
    expect(resultA[0]?.date).toBe("2026-11-01");
    expect(resultB).toHaveLength(1);
    expect(resultB[0]?.date).toBe("2026-11-08");
  });
});
