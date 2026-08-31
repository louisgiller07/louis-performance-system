/// <reference types="node" />
// The reference above brings in @types/node's ambient globals (process,
// NodeJS) for this program — web/tsconfig.app.json deliberately omits
// "node" from its `types` array (src/** is browser code), so this file
// (the first in web/ that legitimately needs server-side test scaffolding:
// a real service_role key from process.env, matching the credential-safety
// convention already used by head-coach-engine/tests/supabase/testDb.ts)
// opts in locally via the directive instead of widening the whole project.
/**
 * Real local Supabase RLS integration tests for the planning write path
 * (V0.3_003B). Exercises the actual planned_sessions_own_data RLS policy
 * with real authenticated user sessions — not the service_role admin
 * client, which bypasses RLS entirely (that's why none of
 * head-coach-engine/tests/supabase/*.integration.test.ts can stand in for
 * this: they only ever use createTestClient(), i.e. admin/service_role).
 *
 * OPT-IN ONLY — a normal `npm test` in web/ must stay self-contained and
 * must never require a running local Supabase stack. This whole suite is
 * skipped unless BOTH of the following are set in the environment:
 *   RUN_LOCAL_SUPABASE_INTEGRATION=1
 *   SUPABASE_SECRET_KEY (or the legacy SUPABASE_SERVICE_ROLE_KEY)
 * A missing opt-in must show up as SKIPPED in the report, never as a
 * silent pass or a hard failure.
 *
 * Run through the repository's established safe local-Supabase test
 * environment; credential-bearing CLI output (e.g. `supabase status -o
 * env`) must be redirected to temporary storage and never printed — see
 * head-coach-engine/tests/supabase/testDb.ts's own header comment for the
 * same discipline.
 *
 * The web app's own vitest.config.ts stubs VITE_SUPABASE_URL/
 * VITE_SUPABASE_PUBLISHABLE_KEY to dummy non-local values globally (see
 * src/lib/supabase.test.ts for the established vi.stubEnv + resetModules +
 * dynamic import pattern reused here) — this file overrides them to the
 * real local Supabase stack for the duration of its own tests only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
// Direct relative source import of the real head-coach-engine test
// scaffolding — reusing the sanctioned admin-client/cleanup helpers rather
// than reinventing them (same proven cross-package boundary as
// planningMappingParity.test.ts / DailyPlanView.enriched.test.tsx).
import { createTestClient, deleteTestAthlete, type TestAthlete } from "../../../../head-coach-engine/tests/supabase/testDb.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
// Explicit two-part opt-in: an environment can carry a server key for
// unrelated reasons (e.g. a shell left over from another task) without that
// alone activating a suite that creates/deletes real local auth users.
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY;

const LOCAL_URL = "http://127.0.0.1:54321";
// LOCAL DEV / PUBLIC — never a secret. The Supabase CLI's well-known
// default local anon key: identical for every local `supabase init`
// install, published by `supabase status`, and compiled into the OSS CLI
// itself (decodes to role: anon, iss: supabase-demo). Same non-secret
// treatment as testDb.ts's LOCAL_URL. Overridable via
// SUPABASE_PUBLISHABLE_KEY (preferred) or SUPABASE_ANON_KEY (legacy) for a
// non-default local setup, mirroring src/lib/supabase.ts's own preference
// order.
const LOCAL_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

interface SignedInTestAthlete extends TestAthlete {
  email: string;
  password: string;
}

/** Like testDb.ts's createTestAthlete, but with a real password so the athlete's user can authenticate via signInWithPassword (needed to exercise RLS as that user, not just as admin/service_role). */
async function createSignedInTestAthlete(admin: SupabaseClient, name: string): Promise<SignedInTestAthlete> {
  const athleteId = crypto.randomUUID();
  const email = `v0.3_003b-planning-test-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomUUID();

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`createSignedInTestAthlete: auth user creation failed: ${userError?.message}`);
  }
  const userId = userData.user.id;

  const { error: athleteError } = await admin.from("athletes").insert({ id: athleteId, user_id: userId, name });
  if (athleteError) {
    // Avoid leaving an orphaned local auth-user fixture behind when the
    // athletes insert fails after the auth user was already created.
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`createSignedInTestAthlete: athletes insert failed: ${athleteError.message}`);
  }

  return { athleteId, userId, email, password };
}

describe.skipIf(!INTEGRATION_ENABLED)("planningRepo — real local Supabase RLS integration (V0.3_003B)", () => {
  let admin: SupabaseClient;
  let athleteA: SignedInTestAthlete;
  let athleteB: SignedInTestAthlete;
  let repo: typeof import("./planningRepo");
  let userClient: SupabaseClient;

  beforeAll(async () => {
    admin = createTestClient();
    athleteA = await createSignedInTestAthlete(admin, "V0.3_003B RLS test athlete A");
    athleteB = await createSignedInTestAthlete(admin, "V0.3_003B RLS test athlete B");

    // Point the real client-side singleton (src/lib/supabase.ts) at the
    // real local stack instead of the dummy env baked in by
    // web/vitest.config.ts, then re-import both it and planningRepo.ts
    // (which statically imports it) so the fresh module picks up the
    // stubbed env — the exact pattern proven in src/lib/supabase.test.ts.
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY);
    vi.resetModules();
    repo = await import("./planningRepo");
    ({ supabase: userClient } = await import("../../lib/supabase"));
  });

  afterAll(async () => {
    await userClient.auth.signOut();
    await deleteTestAthlete(admin, athleteA);
    await deleteTestAthlete(admin, athleteB);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function signInAs(athlete: SignedInTestAthlete): Promise<void> {
    const { error } = await userClient.auth.signInWithPassword({ email: athlete.email, password: athlete.password });
    if (error) throw new Error(`signInAs failed: ${error.message}`);
  }

  it("A. returns an empty array for the caller's own athlete when nothing is planned yet", async () => {
    await signInAs(athleteA);
    const rows = await repo.loadPlannedSessions(athleteA.athleteId, "2026-09-01", "2026-09-01");
    expect(rows).toEqual([]);
  });

  it("B. saves (inserts) a planned session for the caller's own athlete", async () => {
    await signInAs(athleteA);
    const saved = await repo.savePlannedSession(athleteA.athleteId, "2026-09-02", "DH_TECHNICAL", "MODERATE");

    expect(saved.planned_date).toBe("2026-09-02");
    expect(saved.session_type).toBe("DH_TECHNICAL");
    expect(saved.intervention).toEqual({ kind: "DH_TECHNICAL", load_profile: "MODERATE" });
    expect(saved.planned_intent).toBeNull();

    const { data: adminRow } = await admin
      .from("planned_sessions")
      .select("source, planned_intent")
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-09-02")
      .single();
    expect(adminRow?.source).toBe("manual");
    expect(adminRow?.planned_intent).toBeNull();
  });

  it("C. re-saving on the same date replaces the intervention (upsert-replace, not a second row)", async () => {
    await signInAs(athleteA);
    await repo.savePlannedSession(athleteA.athleteId, "2026-09-03", "REST", null);
    const replaced = await repo.savePlannedSession(athleteA.athleteId, "2026-09-03", "AEROBIC_BASE", "LIGHT");

    expect(replaced.intervention).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT" });

    const { data: rows, count } = await admin
      .from("planned_sessions")
      .select("intervention", { count: "exact" })
      .eq("athlete_id", athleteA.athleteId)
      .eq("planned_date", "2026-09-03");
    expect(count).toBe(1);
    expect(rows?.[0]?.intervention).toEqual({ kind: "AEROBIC_BASE", load_profile: "LIGHT" });
  });

  it("D. deleting the caller's own planned session removes it", async () => {
    await signInAs(athleteA);
    await repo.savePlannedSession(athleteA.athleteId, "2026-09-04", "REST", null);
    await repo.deletePlannedSession(athleteA.athleteId, "2026-09-04");

    const rows = await repo.loadPlannedSessions(athleteA.athleteId, "2026-09-04", "2026-09-04");
    expect(rows).toEqual([]);
  });

  it("E. cannot load another athlete's planned session (RLS filters silently, no error)", async () => {
    await admin.from("planned_sessions").insert({
      athlete_id: athleteB.athleteId,
      planned_date: "2026-09-05",
      session_type: "REST",
      intervention: { kind: "REST" },
    });

    await signInAs(athleteA);
    const rows = await repo.loadPlannedSessions(athleteB.athleteId, "2026-09-05", "2026-09-05");
    expect(rows).toEqual([]);
  });

  it("F. cannot save into another athlete's athlete_id (RLS rejects the write)", async () => {
    await signInAs(athleteA);
    await expect(
      repo.savePlannedSession(athleteB.athleteId, "2026-09-06", "STRENGTH_LOWER", "HEAVY")
    ).rejects.toThrow(repo.PlanningSaveError);

    const { data: adminRow } = await admin
      .from("planned_sessions")
      .select("intervention")
      .eq("athlete_id", athleteB.athleteId)
      .eq("planned_date", "2026-09-06")
      .maybeSingle();
    expect(adminRow).toBeNull();
  });

  it("G. cannot delete another athlete's planned session (matches zero rows, no error, row survives)", async () => {
    await admin.from("planned_sessions").insert({
      athlete_id: athleteB.athleteId,
      planned_date: "2026-09-07",
      session_type: "REST",
      intervention: { kind: "REST" },
    });

    await signInAs(athleteA);
    await expect(repo.deletePlannedSession(athleteB.athleteId, "2026-09-07")).resolves.not.toThrow();

    const { data: adminRow } = await admin
      .from("planned_sessions")
      .select("intervention")
      .eq("athlete_id", athleteB.athleteId)
      .eq("planned_date", "2026-09-07")
      .maybeSingle();
    expect(adminRow?.intervention).toEqual({ kind: "REST" });
  });

  it("H. two athletes can each plan their own session on the same date (unique constraint is per-athlete, not global)", async () => {
    await signInAs(athleteA);
    const savedA = await repo.savePlannedSession(athleteA.athleteId, "2026-09-08", "MOBILITY", null);

    await signInAs(athleteB);
    const savedB = await repo.savePlannedSession(athleteB.athleteId, "2026-09-08", "POWER", "HEAVY");

    expect(savedA.intervention).toEqual({ kind: "MOBILITY" });
    expect(savedB.intervention).toEqual({ kind: "POWER", load_profile: "HEAVY" });

    await signInAs(athleteA);
    const rowsA = await repo.loadPlannedSessions(athleteA.athleteId, "2026-09-08", "2026-09-08");
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].intervention).toEqual({ kind: "MOBILITY" });
  });

  describe("OMIT AND PRESERVE — the five engine-inert columns survive an authenticated save untouched", () => {
    it("primary_objective, planned_duration_min, planned_time_of_day, training_block_id, notes are never cleared by savePlannedSession", async () => {
      const { data: block, error: blockError } = await admin
        .from("training_blocks")
        .insert({
          athlete_id: athleteA.athleteId,
          name: "OMIT/PRESERVE fixture block",
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          primary_focus: "test",
          is_current: false,
          mode: "IN_SEASON",
        })
        .select("id")
        .single();
      if (blockError || !block) throw new Error(`training_blocks fixture insert failed: ${blockError?.message}`);

      const date = "2026-09-09";
      const { error: seedError } = await admin.from("planned_sessions").insert({
        athlete_id: athleteA.athleteId,
        planned_date: date,
        session_type: "REST",
        intervention: { kind: "REST" },
        primary_objective: "Pre-existing objective — must survive",
        planned_duration_min: 45,
        planned_time_of_day: "07:30:00",
        training_block_id: block.id,
        notes: "Pre-existing note — must survive",
      });
      if (seedError) throw new Error(`OMIT/PRESERVE seed insert failed: ${seedError.message}`);

      await signInAs(athleteA);
      await repo.savePlannedSession(athleteA.athleteId, date, "DH_PERFORMANCE", "HEAVY");

      const { data: after } = await admin
        .from("planned_sessions")
        .select("intervention, primary_objective, planned_duration_min, planned_time_of_day, training_block_id, notes")
        .eq("athlete_id", athleteA.athleteId)
        .eq("planned_date", date)
        .single();

      expect(after?.intervention).toEqual({ kind: "DH_PERFORMANCE", load_profile: "HEAVY" });
      expect(after?.primary_objective).toBe("Pre-existing objective — must survive");
      expect(after?.planned_duration_min).toBe(45);
      expect(after?.planned_time_of_day).toBe("07:30:00");
      expect(after?.training_block_id).toBe(block.id);
      expect(after?.notes).toBe("Pre-existing note — must survive");

      await admin.from("training_blocks").delete().eq("id", block.id);
    });
  });
});
