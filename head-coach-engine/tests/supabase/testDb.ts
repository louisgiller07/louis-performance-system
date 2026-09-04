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
/** The local Supabase CLI's default REST API port. */
const LOCAL_SUPABASE_PORT = "54321";

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

/**
 * Thrown by {@link createTestClient} instead of ever building a privileged
 * client against a non-local target. `SUPABASE_URL` is environment-derived
 * (see below) — a leftover export from unrelated remote work (e.g.
 * V0.3_002F's rollout) plus a present server key would otherwise be enough
 * to point every fixture helper in this file at a real project. No network
 * call happens before this check (V0.3_003D hardening).
 */
export class UnsafeTestTargetError extends Error {
  constructor(url: string) {
    super(
      `createTestClient refused to build a privileged Supabase client against a non-local target ("${url}"). ` +
        "This test scaffolding may only run against the local Supabase stack " +
        `(${LOCAL_URL} or http://localhost:${LOCAL_SUPABASE_PORT}) — never a remote/hosted project, a different ` +
        "port, or a LAN address, even with a valid server key present. Unset SUPABASE_URL or point it at your " +
        "local stack."
    );
    this.name = "UnsafeTestTargetError";
  }
}

/**
 * True only for an explicit loopback-local Supabase URL on the local
 * stack's own default port (`http://127.0.0.1:54321` or
 * `http://localhost:54321`) — exact hostname AND port match, deliberately
 * narrower than "any localhost port": a stray `SUPABASE_URL` pointing at
 * some other local service on a different port must not silently pass this
 * check either. Never true for a production/hosted project URL, a LAN
 * address, or any `https:` scheme, however it was supplied.
 */
export function isLoopbackSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return false;
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return false;
    return parsed.port === LOCAL_SUPABASE_PORT;
  } catch {
    return false;
  }
}

/** The exact URL `createTestClient()` resolves to and safety-checks — a single source, so the check can never drift from what the client actually targets. */
export function resolveTestSupabaseUrl(): string {
  return process.env.SUPABASE_URL ?? LOCAL_URL;
}

export function createTestClient(): SupabaseClient {
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverKey) throw new MissingTestServerKeyError();

  const url = resolveTestSupabaseUrl();
  if (!isLoopbackSupabaseUrl(url)) throw new UnsafeTestTargetError(url);

  return createSupabaseServerClient({
    url,
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

// Deliberately identical to fixtures/louis.ts's baseCheckin() defaults (M2
// closure pass — read-path equivalence matrix): any scenario override object
// applied to both baseCheckin(overrides) and insertCheckin(...,overrides)
// must leave the *unoverridden* fields in the same PROVISIONAL_THRESHOLDS
// classification band on both sides, or fixture/Supabase equivalence tests
// would compare apples to oranges by accident. Keeping the two default sets
// numerically identical removes that risk entirely rather than relying on
// both sets happening to land in the same GREEN band.
const NEUTRAL_CHECKIN: Required<Omit<CheckinFixture, "pain_location_code">> = {
  sleep_hours: 8,
  sleep_quality: 8,
  sleep_wake_ups: 0,
  energy: 8,
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

/** Minimal direct insert into decisions (admin client only — decisions is append-only, no direct authenticated write path). Returns the new row's id for FK-linkage tests (e.g. M5_003's decision-link preflight). */
export async function insertDecision(
  client: SupabaseClient,
  athleteId: string,
  decisionDate: string,
  fields: { final_session?: string } = {}
): Promise<string> {
  const { data, error } = await client
    .from("decisions")
    .insert({
      athlete_id: athleteId,
      decision_date: decisionDate,
      final_session: fields.final_session ?? "REST",
      reason: "test fixture",
      engine_version: "test",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertDecision failed: ${error?.message}`);
  return data.id as string;
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

/** V0.3_004A — upserts the athlete's coaching-profile row (`athlete_id` is the table's own PK, so this is always exactly 0 or 1 row). */
export async function insertCoachingProfile(
  client: SupabaseClient,
  athleteId: string,
  fields: { technique_primary_focus?: string | null; mental_pre_race_cue?: string | null }
): Promise<void> {
  const { error } = await client.from("athlete_coaching_profiles").upsert({
    athlete_id: athleteId,
    technique_primary_focus: fields.technique_primary_focus ?? null,
    mental_pre_race_cue: fields.mental_pre_race_cue ?? null,
  });
  if (error) throw new Error(`insertCoachingProfile failed: ${error.message}`);
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
