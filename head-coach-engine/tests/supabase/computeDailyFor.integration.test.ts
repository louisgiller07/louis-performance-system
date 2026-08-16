import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDailyPlan } from "../../src/engine/buildDailyPlan.js";
import { computeDailyFor } from "../../src/supabase/computeDailyFor.js";
import { baseRawContext, RACE_CALENDAR } from "../../fixtures/louis.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  insertCheckin,
  insertTrainingBlock,
  insertRace,
  type TestAthlete,
} from "./testDb.js";

describe("M2 read path — computeDailyFor equivalence with M1 fixtures (integration, local Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "computeDailyFor equivalence test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  async function seedRaceCalendar(): Promise<void> {
    for (const race of Object.values(RACE_CALENDAR)) {
      await insertRace(client, athlete.athleteId, {
        event_name: race.event_name,
        start_date: race.event_start,
        end_date: race.event_end,
        priority: race.priority,
        race_format: race.race_format,
      });
    }
  }

  it("produces the exact same DailyPlan as the M1 't6-fallback' scenario", async () => {
    const today = "2026-08-24";
    const fixtureCtx = baseRawContext({
      today,
      active_mode: "OFF_SEASON_DEVELOPMENT",
      planned_session: null,
    });
    const expectedPlan = buildDailyPlan(fixtureCtx);

    await insertCheckin(client, athlete.athleteId, today);
    await insertTrainingBlock(client, athlete.athleteId, "OFF_SEASON_DEVELOPMENT");
    await seedRaceCalendar();

    const { dailyPlan } = await computeDailyFor(client, athlete.athleteId, today);

    expect(dailyPlan).toEqual(expectedPlan);
  });

  it("produces the exact same DailyPlan as the M1 't3-concussion' SAFETY scenario", async () => {
    const today = "2026-08-24";
    const fixtureCtx = baseRawContext({ checkin: { suspected_concussion: true } });
    const expectedPlan = buildDailyPlan(fixtureCtx);

    await insertCheckin(client, athlete.athleteId, today, { suspected_concussion: true });
    await insertTrainingBlock(client, athlete.athleteId, "RACE_CLUSTER");
    await seedRaceCalendar();

    const { dailyPlan } = await computeDailyFor(client, athlete.athleteId, today);

    expect(dailyPlan).toEqual(expectedPlan);
    expect(dailyPlan.decision).toBe("REST");
    expect(dailyPlan.confidence).toBe("HIGH");
  });
});

describe("M2 read path — computeDailyFor performs zero writes (integration, local Supabase)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "computeDailyFor zero-write test athlete");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  async function countRows(table: string): Promise<number> {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("athlete_id", athlete.athleteId);
    if (error) throw new Error(`countRows(${table}) failed: ${error.message}`);
    return count ?? 0;
  }

  it("leaves decisions, health_flags, planned_sessions, completed_sessions and daily_checkins counts unchanged", async () => {
    const today = "2026-08-24";
    await insertCheckin(client, athlete.athleteId, today, { suspected_concussion: true });
    await insertTrainingBlock(client, athlete.athleteId, "RACE_CLUSTER");

    const tables = ["decisions", "health_flags", "planned_sessions", "completed_sessions", "daily_checkins"];
    const before: Record<string, number> = {};
    for (const table of tables) before[table] = await countRows(table);

    const { dailyPlan } = await computeDailyFor(client, athlete.athleteId, today);
    expect(dailyPlan.decision).toBe("REST"); // sanity: the SAFETY path was actually exercised

    const after: Record<string, number> = {};
    for (const table of tables) after[table] = await countRows(table);

    expect(after).toEqual(before);
  });
});
