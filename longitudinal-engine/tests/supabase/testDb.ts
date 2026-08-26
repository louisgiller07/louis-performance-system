/**
 * Test-only fixture helpers for the longitudinal-engine Supabase adapter
 * integration suite. Not part of src/** — this is test scaffolding.
 *
 * Deliberately self-contained: does NOT import head-coach-engine's own
 * client factory or test fixtures, even though this is exactly the same
 * shape of helper — longitudinal-engine/** (tests/** included) must never
 * import from head-coach-engine/**, see docs/11_DECISION_LOG.md (M5_002A).
 *
 * Connects to the local Supabase CLI stack only. The server key is never
 * hardcoded — it must come from SUPABASE_SECRET_KEY or
 * SUPABASE_SERVICE_ROLE_KEY in the environment. Run with, e.g.:
 *   SUPABASE_SECRET_KEY="$(npx supabase status -o env | grep SECRET_KEY | cut -d'"' -f2)" npm test
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";

export class MissingTestServerKeyError extends Error {
  constructor() {
    super(
      "No Supabase server key found in the environment for the longitudinal-engine adapter " +
        "integration tests. Set SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY to " +
        "your local Supabase stack's key before running these tests — get it via " +
        "`npx supabase status -o env`. No key is hardcoded in this file."
    );
    this.name = "MissingTestServerKeyError";
  }
}

export function createTestClient(): SupabaseClient {
  const serverKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverKey) throw new MissingTestServerKeyError();

  return createClient(process.env.SUPABASE_URL ?? LOCAL_URL, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestAthlete {
  athleteId: string;
  userId: string;
}

/**
 * Creates a scratch auth user + `athletes` row pair. Caller must clean up
 * via {@link deleteTestAthlete}.
 */
export async function createTestAthlete(client: SupabaseClient, name: string): Promise<TestAthlete> {
  const athleteId = randomUUID();
  const email = `longitudinal-adapter-test-${randomUUID()}@example.invalid`;

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

/**
 * Deletes the athlete row then the auth user. FK cascade (all athlete_id
 * columns in this schema are ON DELETE CASCADE, decision_outcomes
 * included — see its own migration) removes every fixture row created
 * under this athlete: daily_checkins, decisions, completed_sessions,
 * decision_outcomes, health_flags.
 */
export async function deleteTestAthlete(client: SupabaseClient, athlete: TestAthlete): Promise<void> {
  const { error } = await client.from("athletes").delete().eq("id", athlete.athleteId);
  if (error) throw new Error(`deleteTestAthlete: athletes delete failed: ${error.message}`);
  await client.auth.admin.deleteUser(athlete.userId);
}

/** Counts remaining rows for an athlete across every table this suite writes to — used to prove zero fixture leftovers after cleanup. */
export async function countRowsForAthlete(client: SupabaseClient, athleteId: string): Promise<Record<string, number>> {
  const tables = ["daily_checkins", "decisions", "completed_sessions", "decision_outcomes", "health_flags"] as const;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const { count, error } = await client.from(table).select("id", { count: "exact", head: true }).eq("athlete_id", athleteId);
    if (error) throw new Error(`countRowsForAthlete: ${table} count failed: ${error.message}`);
    counts[table] = count ?? 0;
  }
  return counts;
}

export interface CheckinOverrides {
  free_comment?: string | null;
  pain?: boolean;
  pain_intensity?: number | null;
  /** M5_006C pain-persistence detector fixtures. */
  pain_new?: boolean | null;
  pain_traumatic?: boolean | null;
  pain_function_loss?: boolean | null;
  pain_getting_worse?: boolean | null;
  pain_location_code?: string | null;
  sleep_hours?: number | null;
  /** M5_006B sleep-energy detector fixtures. */
  sleep_quality?: number | null;
  energy?: number | null;
  suspected_concussion?: boolean;
  fever_or_illness?: boolean;
}

export async function insertCheckin(
  client: SupabaseClient,
  athleteId: string,
  date: string,
  overrides: CheckinOverrides = {}
): Promise<string> {
  const { data, error } = await client
    .from("daily_checkins")
    .insert({
      athlete_id: athleteId,
      checkin_date: date,
      energy: 7,
      leg_fatigue: 3,
      grip_fatigue: 2,
      motivation: 7,
      work_stress: 3,
      sleep_quality: 7,
      sleep_wake_ups: 0,
      pain: false,
      suspected_concussion: false,
      fever_or_illness: false,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertCheckin failed: ${error?.message}`);
  return data.id as string;
}

export interface DecisionOverrides {
  final_session?: string;
  computed_at?: string;
  active_mode?: string | null;
  confidence_level?: string | null;
  daily_plan?: Record<string, unknown> | null;
  overridden_by_user?: boolean;
}

export async function insertDecision(
  client: SupabaseClient,
  athleteId: string,
  decisionDate: string,
  overrides: DecisionOverrides = {}
): Promise<string> {
  const { final_session = "REST", ...rest } = overrides;
  const { data, error } = await client
    .from("decisions")
    .insert({
      athlete_id: athleteId,
      decision_date: decisionDate,
      final_session,
      reason: "test fixture",
      engine_version: "test",
      ...rest,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertDecision failed: ${error?.message}`);
  return data.id as string;
}

export interface CompletedSessionOverrides {
  decision_id?: string | null;
  session_type?: string;
  completion_status?: string;
  intervention?: Record<string, unknown> | null;
  main_content?: Record<string, unknown> | null;
}

export async function insertCompletedSession(
  client: SupabaseClient,
  athleteId: string,
  sessionDate: string,
  overrides: CompletedSessionOverrides = {}
): Promise<string> {
  const { session_type = "RECOVERY", completion_status = "done", ...rest } = overrides;
  const { data, error } = await client
    .from("completed_sessions")
    .insert({
      athlete_id: athleteId,
      session_date: sessionDate,
      session_type,
      completion_status,
      new_pain: false,
      ...rest,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertCompletedSession failed: ${error?.message}`);
  return data.id as string;
}

export interface DecisionOutcomeOverrides {
  calculated_at?: string;
  calculator_id?: string;
  calculator_version?: string;
  horizon?: string;
}

export async function insertDecisionOutcome(
  client: SupabaseClient,
  athleteId: string,
  decisionId: string,
  inputSnapshot: Record<string, unknown>,
  outcomeSignals: Record<string, unknown>,
  overrides: DecisionOutcomeOverrides = {}
): Promise<string> {
  const { horizon = "J_PLUS_1", calculator_id = "test_calculator", calculator_version = "v1", ...rest } = overrides;
  const { data, error } = await client
    .from("decision_outcomes")
    .insert({
      athlete_id: athleteId,
      decision_id: decisionId,
      horizon,
      calculator_id,
      calculator_version,
      input_snapshot: inputSnapshot,
      outcome_signals: outcomeSignals,
      ...rest,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertDecisionOutcome failed: ${error?.message}`);
  return data.id as string;
}

export interface HealthFlagOverrides {
  flag_type?: string;
  status?: "active" | "monitoring" | "resolved";
  resolved_at?: string | null;
  description?: string;
}

export async function insertHealthFlag(
  client: SupabaseClient,
  athleteId: string,
  flagDate: string,
  overrides: HealthFlagOverrides = {}
): Promise<string> {
  const { flag_type = "injury_suspect", status = "active", description = "test fixture", ...rest } = overrides;
  const { data, error } = await client
    .from("health_flags")
    .insert({
      athlete_id: athleteId,
      flag_date: flagDate,
      flag_type,
      status,
      description,
      ...rest,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertHealthFlag failed: ${error?.message}`);
  return data.id as string;
}
