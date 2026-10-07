/**
 * A09 — a rider manages their own races under RLS (race_calendar_own_data,
 * baseline migration): create / read / update / delete their rows, never
 * another rider's. The row the web writes (status planned, A/B/C, 2 / 3 days
 * or OTHER) is read by the engine's race window as is. Local Supabase only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertRace, type TestAthlete } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { getRacesInWindow } from "../../src/supabase/repositories/raceCalendarRepo.js";
import { mapRaceCalendarRow } from "../../src/supabase/mapping/raceCalendarRow.js";

const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

describe.skipIf(!INTEGRATION_ENABLED)("A09 — race_calendar written by the rider (local Supabase, RLS)", () => {
  let admin: SupabaseClient;
  let a: TestAthlete;
  let b: TestAthlete;
  const count = (athleteId: string) => execLocalSql(`select count(*) from public.race_calendar where athlete_id = ${sqlLiteral(athleteId)};`).trim();

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    a = await createTestAthlete(admin, "A09 rider A");
    b = await createTestAthlete(admin, "A09 rider B");
    await insertRace(admin, b.athleteId, { event_name: "B private race", start_date: "2026-10-24", end_date: "2026-10-25", priority: "A" });
  }, 60_000);

  it("rider A: create (planned, as the web writes it), read, update, delete their own race; the engine reads it unchanged", async () => {
    const rider = await getAthleteAuthClient(a.athleteId);
    const created = await rider
      .from("race_calendar")
      .insert({ athlete_id: a.athleteId, status: "planned", event_name: "Hot Trail", start_date: "2026-10-17", end_date: "2026-10-18", priority: "A", race_format: "HOT_TRAIL_2DAY" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const id = (created.data as { id: string }).id;

    const engineRows = await getRacesInWindow(admin, a.athleteId, "2026-10-11");
    expect(engineRows.map((row) => mapRaceCalendarRow(row).race)).toEqual([
      { event_name: "Hot Trail", event_start: "2026-10-17", event_end: "2026-10-18", priority: "A", race_format: "HOT_TRAIL_2DAY" },
    ]);

    expect((await rider.from("race_calendar").update({ priority: "C", race_format: "OTHER" }).eq("id", id)).error).toBeNull();
    expect(execLocalSql(`select priority || '/' || race_format || '/' || status from public.race_calendar where id = ${sqlLiteral(id)};`).trim()).toBe("C/OTHER/planned");
    expect((await rider.from("race_calendar").delete().eq("id", id)).error).toBeNull();
    expect(count(a.athleteId)).toBe("0");
  });

  it("rider A can neither read, insert for, update nor delete rider B's races", async () => {
    const rider = await getAthleteAuthClient(a.athleteId);
    const read = await rider.from("race_calendar").select("id").eq("athlete_id", b.athleteId);
    expect(read.data).toEqual([]);
    expect((await rider.from("race_calendar").insert({ athlete_id: b.athleteId, event_name: "forged", start_date: "2026-10-30", end_date: "2026-10-30", priority: "B" })).error?.code).toBe("42501");
    await rider.from("race_calendar").update({ event_name: "hijacked" }).eq("athlete_id", b.athleteId);
    await rider.from("race_calendar").delete().eq("athlete_id", b.athleteId);
    expect(execLocalSql(`select event_name from public.race_calendar where athlete_id = ${sqlLiteral(b.athleteId)};`).trim()).toBe("B private race");
  });
});
