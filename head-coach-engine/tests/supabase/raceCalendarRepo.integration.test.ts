/**
 * PILOT_004 — deterministic race ordering against a real local Supabase:
 * start_date, end_date, created_at, id (all ascending). Race A is inserted
 * first, then updated, which moves its row version after Race B physically —
 * without the ORDER BY, Postgres would return B first.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertRace,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { getRacesInWindow, getRacesOverlappingRange } from "../../src/supabase/repositories/raceCalendarRepo.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-09-23";

describe.skipIf(!INTEGRATION_ENABLED)("PILOT_004 — raceCalendarRepo deterministic ordering (real local Supabase)", () => {
  let admin: SupabaseClient;
  let athlete: TestAthlete;

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    if (athlete) await deleteTestAthlete(admin, athlete);
  });

  it("same dates -> insertion order (created_at), stable over repeated reads; an earlier start_date always comes first", async () => {
    athlete = await createTestAthlete(admin, "PILOT_004 race ordering");

    // Names deliberately NOT in alphabetical insertion order.
    await insertRace(admin, athlete.athleteId, { event_name: "Zeta race (A)", start_date: "2026-09-25", end_date: "2026-09-26", priority: "A" });
    await insertRace(admin, athlete.athleteId, { event_name: "Alpha race (B)", start_date: "2026-09-25", end_date: "2026-09-26", priority: "A" });

    // Rewrites A's row version after B's in the heap — physical order is now B, A.
    const { error: updateError } = await admin
      .from("race_calendar")
      .update({ notes: "touched after B was inserted" })
      .eq("athlete_id", athlete.athleteId)
      .eq("event_name", "Zeta race (A)");
    if (updateError) throw new Error(`race_calendar update failed: ${updateError.message}`);

    for (let read = 0; read < 5; read++) {
      const rows = await getRacesInWindow(admin, athlete.athleteId, TODAY);
      expect(rows.map((r) => r.event_name)).toEqual(["Zeta race (A)", "Alpha race (B)"]);
    }

    // Created last, but starts earlier: start_date stays the first criterion.
    await insertRace(admin, athlete.athleteId, { event_name: "Earlier race (C)", start_date: "2026-09-24", end_date: "2026-09-24", priority: "C" });

    const inWindow = await getRacesInWindow(admin, athlete.athleteId, TODAY);
    expect(inWindow.map((r) => r.event_name)).toEqual(["Earlier race (C)", "Zeta race (A)", "Alpha race (B)"]);

    const overlapping = await getRacesOverlappingRange(admin, athlete.athleteId, "2026-09-23", "2026-10-07", TODAY);
    expect(overlapping.map((r) => r.event_name)).toEqual(["Earlier race (C)", "Zeta race (A)", "Alpha race (B)"]);
  });
});
