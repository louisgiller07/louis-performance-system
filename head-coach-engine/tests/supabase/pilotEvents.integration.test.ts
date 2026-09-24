/**
 * PILOT_008 — pilot_observability_events against a real local Supabase:
 * service_role may only INSERT (append-only by grants), authenticated/anon
 * have no access at all. The table grants no SELECT to anyone but the admin
 * SQL role, so a successful write is proven by the insert result plus the
 * table's own CHECK constraint rejecting an unknown event type.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  getAthleteAuthClient,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";
import { PILOT_EVENTS_TABLE, recordPilotEvent, toPilotEventRow, type PilotEvent } from "../../src/supabase/observability/pilotEvents.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!PUBLISHABLE_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const PERMISSION_DENIED = "42501";

describe.skipIf(!INTEGRATION_ENABLED)("PILOT_008 — pilot_observability_events grants (real local Supabase)", () => {
  let admin: SupabaseClient;
  let athlete: TestAthlete;

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    if (athlete) await deleteTestAthlete(admin, athlete);
  });

  function event(athleteId: string): PilotEvent {
    return { eventType: "daily_run_failed", athleteId, eventDate: "2026-09-24", errorName: "Error", errorCode: "pilot_008_integration" };
  }

  it("service_role can INSERT; the row really reaches the table (CHECK constraint enforced)", async () => {
    athlete = await createTestAthlete(admin, "PILOT_008 observability");

    const { error } = await admin.from(PILOT_EVENTS_TABLE).insert(toPilotEventRow(event(athlete.athleteId)));
    expect(error).toBeNull();

    const { error: invalidError } = await admin
      .from(PILOT_EVENTS_TABLE)
      .insert({ ...toPilotEventRow(event(athlete.athleteId)), event_type: "not_a_pilot_event" });
    expect(invalidError?.code).toBe("23514");

    await expect(recordPilotEvent(admin, event(athlete.athleteId))).resolves.toBeUndefined();
  });

  it("service_role cannot SELECT, UPDATE or DELETE (append-only)", async () => {
    athlete = await createTestAthlete(admin, "PILOT_008 observability append-only");

    const select = await admin.from(PILOT_EVENTS_TABLE).select("id").limit(1);
    const update = await admin.from(PILOT_EVENTS_TABLE).update({ severity: "info" }).eq("athlete_id", athlete.athleteId);
    const del = await admin.from(PILOT_EVENTS_TABLE).delete().eq("athlete_id", athlete.athleteId);

    expect(select.error?.code).toBe(PERMISSION_DENIED);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
  });

  it("an authenticated athlete cannot SELECT, INSERT, UPDATE or DELETE — not even its own events", async () => {
    athlete = await createTestAthlete(admin, "PILOT_008 observability authenticated");
    const own = await getAthleteAuthClient(athlete.athleteId);

    const select = await own.from(PILOT_EVENTS_TABLE).select("id").limit(1);
    const insert = await own.from(PILOT_EVENTS_TABLE).insert(toPilotEventRow(event(athlete.athleteId)));
    const update = await own.from(PILOT_EVENTS_TABLE).update({ severity: "info" }).eq("athlete_id", athlete.athleteId);
    const del = await own.from(PILOT_EVENTS_TABLE).delete().eq("athlete_id", athlete.athleteId);

    expect(select.error?.code).toBe(PERMISSION_DENIED);
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
  });

  it("anon cannot SELECT or INSERT", async () => {
    athlete = await createTestAthlete(admin, "PILOT_008 observability anon");
    const anon = createClient(resolveTestSupabaseUrl(), PUBLISHABLE_KEY as string, { auth: { persistSession: false } });

    const select = await anon.from(PILOT_EVENTS_TABLE).select("id").limit(1);
    const insert = await anon.from(PILOT_EVENTS_TABLE).insert(toPilotEventRow(event(athlete.athleteId)));

    expect(select.error?.code).toBe(PERMISSION_DENIED);
    expect(insert.error?.code).toBe(PERMISSION_DENIED);
  });
});
