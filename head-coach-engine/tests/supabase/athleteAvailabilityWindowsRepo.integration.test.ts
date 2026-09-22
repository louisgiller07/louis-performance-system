/**
 * V0.4_101 — real local Supabase proof for athleteAvailabilityWindowsRepo.ts:
 * a real round-trip against `athlete_availability_windows` through the
 * actual `@supabase/supabase-js` client (never mocked).
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestClient, createTestAthlete, deleteTestAthlete, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, type TestAthlete } from "./testDb.js";
import { getAvailabilityWindowsFor, insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

describe.skipIf(!INTEGRATION_ENABLED)("V0.4_101 — athleteAvailabilityWindowsRepo (real local Supabase)", () => {
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

  it("an athlete with no windows declared resolves to an empty array, never an error", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 no windows");

    const result = await getAvailabilityWindowsFor(admin, athleteA.athleteId);

    expect(result).toEqual([]);
  });

  it("insert then read round-trips every window field, multiple rows per athlete", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 windows");

    await insertAvailabilityWindow(admin, athleteA.athleteId, { day_of_week: 2, start_time: "17:00", end_time: "19:00", label: "Tuesday evening" });
    await insertAvailabilityWindow(admin, athleteA.athleteId, { day_of_week: 6, start_time: "09:00", end_time: "17:00" });

    const result = await getAvailabilityWindowsFor(admin, athleteA.athleteId);

    expect(result).toHaveLength(2);
    expect(result.map((w) => w.day_of_week).sort()).toEqual([2, 6]);
    expect(result.find((w) => w.day_of_week === 2)?.label).toBe("Tuesday evening");
  });

  it("athlete isolation: A's windows never leak into B's read", async () => {
    athleteA = await createTestAthlete(admin, "V0.4_101 window isolation A");
    athleteB = await createTestAthlete(admin, "V0.4_101 window isolation B");
    await insertAvailabilityWindow(admin, athleteA.athleteId, { day_of_week: 1, start_time: "08:00", end_time: "10:00" });
    await insertAvailabilityWindow(admin, athleteB.athleteId, { day_of_week: 5, start_time: "12:00", end_time: "14:00" });

    const resultA = await getAvailabilityWindowsFor(admin, athleteA.athleteId);
    const resultB = await getAvailabilityWindowsFor(admin, athleteB.athleteId);

    expect(resultA).toHaveLength(1);
    expect(resultA[0]?.day_of_week).toBe(1);
    expect(resultB).toHaveLength(1);
    expect(resultB[0]?.day_of_week).toBe(5);
  });
});
