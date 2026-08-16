/**
 * Test-only fixture helpers for the M2 read-path integration suite.
 * Not part of `src/` — this is test scaffolding, not production code.
 *
 * Connects to the local Supabase CLI stack only. `LOCAL_URL` is the
 * well-known, non-secret default published by `supabase status` for every
 * local install (overridable via `SUPABASE_URL`). The server key is never
 * hardcoded here — it must come from `SUPABASE_SECRET_KEY` or
 * `SUPABASE_SERVICE_ROLE_KEY` in the environment (see
 * docs/11_DECISION_LOG.md, M2 read-path review). Run with, e.g.:
 *   SUPABASE_SECRET_KEY="$(npx supabase status -o env | grep SECRET_KEY | cut -d'"' -f2)" npm test
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../../src/supabase/client.js";

const LOCAL_URL = "http://127.0.0.1:54321";

export class MissingTestServerKeyError extends Error {
  constructor() {
    super(
      "No Supabase server key found in the environment for the M2 read-path integration tests. " +
        "Set SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY to your local Supabase " +
        "stack's key before running these tests — get it via `npx supabase status -o env`. " +
        "No key is hardcoded in this file."
    );
    this.name = "MissingTestServerKeyError";
  }
}

export function createTestClient(): SupabaseClient {
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverKey) throw new MissingTestServerKeyError();

  return createSupabaseServerClient({
    url: process.env.SUPABASE_URL ?? LOCAL_URL,
    serverKey,
  });
}

export interface TestAthlete {
  athleteId: string;
  userId: string;
}

/**
 * Creates a scratch auth user (via the GoTrue Admin API — PostgREST does
 * not expose the `auth` schema directly, even to service_role) + an
 * `athletes` row pair. Caller must clean up via {@link deleteTestAthlete}.
 */
export async function createTestAthlete(client: SupabaseClient, name: string): Promise<TestAthlete> {
  const athleteId = randomUUID();
  const email = `m2-read-path-test-${randomUUID()}@example.invalid`;

  const { data: userData, error: userError } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`createTestAthlete: auth user creation failed: ${userError?.message}`);
  }
  const userId = userData.user.id;

  const { error: athleteError } = await client.from("athletes").insert({ id: athleteId, user_id: userId, name });
  if (athleteError) throw new Error(`createTestAthlete: athletes insert failed: ${athleteError.message}`);

  return { athleteId, userId };
}

/** Deletes the athlete (cascades decisions/health_flags/planned_sessions/completed_sessions/daily_checkins) then the auth user. */
export async function deleteTestAthlete(client: SupabaseClient, athlete: TestAthlete): Promise<void> {
  await client.from("athletes").delete().eq("id", athlete.athleteId);
  await client.auth.admin.deleteUser(athlete.userId);
}

export interface CheckinFixture {
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  sleep_wake_ups?: number | null;
  energy?: number | null;
  work_stress?: number | null;
  motivation?: number | null;
  leg_fatigue?: number | null;
  grip_fatigue?: number | null;
  pain?: boolean;
  pain_intensity?: number | null;
  pain_new?: boolean | null;
  pain_location_code?: string | null;
  pain_traumatic?: boolean | null;
  pain_function_loss?: boolean | null;
  pain_getting_worse?: boolean | null;
  suspected_concussion?: boolean;
  fever_or_illness?: boolean;
}

const NEUTRAL_CHECKIN: Required<Omit<CheckinFixture, "pain_location_code">> = {
  sleep_hours: 7.5,
  sleep_quality: 7,
  sleep_wake_ups: 1,
  energy: 6,
  work_stress: 3,
  motivation: 8,
  leg_fatigue: 2,
  grip_fatigue: 2,
  pain: false,
  pain_intensity: null,
  pain_new: false,
  pain_traumatic: false,
  pain_function_loss: false,
  pain_getting_worse: false,
  suspected_concussion: false,
  fever_or_illness: false,
};

export async function insertCheckin(
  client: SupabaseClient,
  athleteId: string,
  date: string,
  overrides: CheckinFixture = {}
): Promise<void> {
  const { error } = await client
    .from("daily_checkins")
    .insert({ athlete_id: athleteId, checkin_date: date, ...NEUTRAL_CHECKIN, ...overrides });
  if (error) throw new Error(`insertCheckin failed: ${error.message}`);
}

export async function insertTrainingBlock(
  client: SupabaseClient,
  athleteId: string,
  mode: string
): Promise<void> {
  const { error } = await client.from("training_blocks").insert({
    athlete_id: athleteId,
    name: "Test block",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    primary_focus: "test",
    is_current: true,
    mode,
  });
  if (error) throw new Error(`insertTrainingBlock failed: ${error.message}`);
}

export async function insertPlannedSession(
  client: SupabaseClient,
  athleteId: string,
  date: string,
  fields: { session_type: string; intervention?: unknown; planned_intent?: string | null }
): Promise<void> {
  const { error } = await client.from("planned_sessions").insert({
    athlete_id: athleteId,
    planned_date: date,
    session_type: fields.session_type,
    intervention: fields.intervention ?? null,
    planned_intent: fields.planned_intent ?? null,
  });
  if (error) throw new Error(`insertPlannedSession failed: ${error.message}`);
}

export async function insertHealthFlag(
  client: SupabaseClient,
  athleteId: string,
  flagType: string,
  status: "active" | "monitoring" | "resolved",
  description = "Test flag"
): Promise<void> {
  const { error } = await client
    .from("health_flags")
    .insert({ athlete_id: athleteId, flag_date: "2026-08-16", flag_type: flagType, status, description });
  if (error) throw new Error(`insertHealthFlag failed: ${error.message}`);
}

export async function insertCompletedSession(
  client: SupabaseClient,
  athleteId: string,
  date: string,
  sessionType: string,
  intervention: unknown
): Promise<void> {
  const { error } = await client.from("completed_sessions").insert({
    athlete_id: athleteId,
    session_date: date,
    session_type: sessionType,
    completion_status: "done",
    intervention,
  });
  if (error) throw new Error(`insertCompletedSession failed: ${error.message}`);
}

export async function insertRace(
  client: SupabaseClient,
  athleteId: string,
  fields: { event_name: string; start_date: string; end_date: string; priority?: string; race_format?: string }
): Promise<void> {
  const { error } = await client.from("race_calendar").insert({
    athlete_id: athleteId,
    event_name: fields.event_name,
    start_date: fields.start_date,
    end_date: fields.end_date,
    priority: fields.priority ?? "B",
    race_format: fields.race_format ?? null,
  });
  if (error) throw new Error(`insertRace failed: ${error.message}`);
}
