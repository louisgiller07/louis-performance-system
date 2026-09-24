/**
 * PILOT_012 — health-data consent on athlete_onboarding_profiles, against a real local
 * Supabase, written exactly like the web app does (the athlete's own client under RLS):
 * completion requires a consented notice version, health_data_consent_at is set by the
 * server only, and an athlete can never write another athlete's consent.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient().
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  getAthleteAuthClient,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!PUBLISHABLE_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const NOTICE_VERSION = "2026-09-24";
const ANSWERS = {
  competition_level: "Amateur racer",
  primary_goal: "Race performance",
  weekly_training_hours: "5-10h",
  preferred_riding_days: ["Saturday"],
};

describe.skipIf(!INTEGRATION_ENABLED)("PILOT_012 — health-data consent (real local Supabase)", () => {
  let admin: SupabaseClient;
  const athletes: TestAthlete[] = [];

  beforeAll(() => {
    admin = createTestClient();
  });

  afterEach(async () => {
    while (athletes.length) await deleteTestAthlete(admin, athletes.pop()!);
  });

  async function newAthlete(label: string): Promise<{ athlete: TestAthlete; own: SupabaseClient }> {
    const athlete = await createTestAthlete(admin, `PILOT_012 consent ${label}`);
    athletes.push(athlete);
    return { athlete, own: await getAthleteAuthClient(athlete.athleteId) };
  }

  async function consentRow(athleteId: string) {
    const { data, error } = await admin
      .from("athlete_onboarding_profiles")
      .select("onboarding_completed_at, privacy_notice_version, health_data_consent_at")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (error) throw new Error(`consent row read failed: ${error.message}`);
    return data;
  }

  it("completing onboarding without consent is rejected by the database (CHECK 23514)", async () => {
    const { athlete, own } = await newAthlete("no-consent");

    const { error } = await own
      .from("athlete_onboarding_profiles")
      .upsert({ athlete_id: athlete.athleteId, ...ANSWERS, onboarding_completed_at: new Date().toISOString() }, { onConflict: "athlete_id" });

    expect(error?.code).toBe("23514");
    expect(await consentRow(athlete.athleteId)).toBeNull();
  });

  it("completing with the notice version persists the version and a server-set timestamp (a client-sent timestamp is ignored)", async () => {
    const { athlete, own } = await newAthlete("with-consent");
    const before = Date.now();

    const { error } = await own.from("athlete_onboarding_profiles").upsert(
      {
        athlete_id: athlete.athleteId,
        ...ANSWERS,
        onboarding_completed_at: new Date().toISOString(),
        privacy_notice_version: NOTICE_VERSION,
        health_data_consent_at: "2000-01-01T00:00:00Z",
      },
      { onConflict: "athlete_id" }
    );
    expect(error).toBeNull();

    const row = await consentRow(athlete.athleteId);
    expect(row?.privacy_notice_version).toBe(NOTICE_VERSION);
    expect(row?.health_data_consent_at).not.toBeNull();
    expect(Date.parse(row!.health_data_consent_at as string)).toBeGreaterThanOrEqual(before - 60_000);
  });

  it("an athlete who has not consented yet can record consent later on their own row (the web gate path)", async () => {
    const { athlete, own } = await newAthlete("later-consent");
    await own.from("athlete_onboarding_profiles").upsert({ athlete_id: athlete.athleteId, ...ANSWERS }, { onConflict: "athlete_id" });
    expect((await consentRow(athlete.athleteId))?.health_data_consent_at).toBeNull();

    const { data, error } = await own
      .from("athlete_onboarding_profiles")
      .update({ privacy_notice_version: NOTICE_VERSION })
      .eq("athlete_id", athlete.athleteId)
      .select("athlete_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const row = await consentRow(athlete.athleteId);
    expect(row?.privacy_notice_version).toBe(NOTICE_VERSION);
    expect(row?.health_data_consent_at).not.toBeNull();
  });

  it("the consent timestamp cannot be rewritten by the client once set", async () => {
    const { athlete, own } = await newAthlete("tamper");
    await own
      .from("athlete_onboarding_profiles")
      .upsert({ athlete_id: athlete.athleteId, ...ANSWERS, privacy_notice_version: NOTICE_VERSION }, { onConflict: "athlete_id" });
    const original = (await consentRow(athlete.athleteId))?.health_data_consent_at;

    await own.from("athlete_onboarding_profiles").update({ health_data_consent_at: "2000-01-01T00:00:00Z" }).eq("athlete_id", athlete.athleteId);

    expect((await consentRow(athlete.athleteId))?.health_data_consent_at).toBe(original);
  });

  it("one athlete cannot read or modify another athlete's consent", async () => {
    const { athlete: a, own: ownA } = await newAthlete("A");
    const { own: ownB } = await newAthlete("B");
    await ownA.from("athlete_onboarding_profiles").upsert({ athlete_id: a.athleteId, ...ANSWERS }, { onConflict: "athlete_id" });

    const read = await ownB.from("athlete_onboarding_profiles").select("athlete_id").eq("athlete_id", a.athleteId);
    const write = await ownB
      .from("athlete_onboarding_profiles")
      .update({ privacy_notice_version: NOTICE_VERSION })
      .eq("athlete_id", a.athleteId)
      .select("athlete_id");
    const insertForA = await ownB
      .from("athlete_onboarding_profiles")
      .upsert({ athlete_id: a.athleteId, ...ANSWERS, privacy_notice_version: NOTICE_VERSION }, { onConflict: "athlete_id" });

    expect(read.data).toEqual([]);
    expect(write.data).toEqual([]);
    expect(insertForA.error).not.toBeNull();
    const row = await consentRow(a.athleteId);
    expect(row?.privacy_notice_version).toBeNull();
    expect(row?.health_data_consent_at).toBeNull();
  });
});
