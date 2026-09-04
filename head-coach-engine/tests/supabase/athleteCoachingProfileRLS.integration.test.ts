/**
 * V0.3_004A — real local RLS proof for `athlete_coaching_profiles`, the new
 * athlete-owned table introduced by this slice. Mirrors the same
 * authenticated-real-session pattern already established by
 * web/src/features/planning/planningRepo.integration.test.ts for
 * `planned_sessions` — two real signed-in Supabase users (never the
 * service_role admin client for the actual RLS-scoped reads/writes under
 * test), proving both positive own-data access AND negative cross-athlete
 * isolation empirically, not just by policy inspection.
 *
 * OPT-IN ONLY, hard-bound to loopback — see testDb.ts's createTestClient()
 * for the actual enforcement (the final backstop even if this file's own
 * skip logic ever regresses). This whole suite is skipped unless ALL of:
 *   RUN_LOCAL_SUPABASE_INTEGRATION=1
 *   a local server key is present
 *   the resolved SUPABASE_URL is explicitly http://127.0.0.1:54321 or
 *     http://localhost:54321
 * A missing opt-in, missing key, or non-loopback URL all show up as
 * SKIPPED, never a silent pass or a hard failure. There is no remote mode.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createTestClient,
  deleteTestAthlete,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const RESOLVED_ADMIN_URL = resolveTestSupabaseUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" &&
  !!SERVER_KEY &&
  !!PUBLISHABLE_KEY &&
  isLoopbackSupabaseUrl(RESOLVED_ADMIN_URL);

interface SignedInScratchAthlete extends TestAthlete {
  authClient: SupabaseClient;
}

/**
 * Creates a scratch auth user WITH a real password (unlike testDb.ts's
 * createTestAthlete, which never sets one — it's only ever used with the
 * admin client) plus its athletes row, then signs in as that user with a
 * plain publishable-key client. Cleanup via testDb.ts's own
 * deleteTestAthlete (same {athleteId, userId} shape).
 */
async function createSignedInScratchAthlete(admin: SupabaseClient, name: string): Promise<SignedInScratchAthlete> {
  const athleteId = randomUUID();
  const email = `v0-3-004a-rls-test-${randomUUID()}@example.invalid`;
  const password = randomUUID();

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`createSignedInScratchAthlete: auth user creation failed: ${userError?.message}`);
  }
  const userId = userData.user.id;

  const { error: athleteError } = await admin.from("athletes").insert({ id: athleteId, user_id: userId, name });
  if (athleteError) throw new Error(`createSignedInScratchAthlete: athletes insert failed: ${athleteError.message}`);

  const authClient = createClient(RESOLVED_ADMIN_URL, PUBLISHABLE_KEY as string);
  const { error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInScratchAthlete: sign-in failed: ${signInError.message}`);

  return { athleteId, userId, authClient };
}

// Always-on, pure, network-free — mirrors T17's own negative gate proof:
// the real production project URL can never satisfy this suite's gate.
describe("athlete_coaching_profiles RLS gate — local-target safety (always-on, no network)", () => {
  it("the real production Supabase project URL is never loopback", () => {
    expect(isLoopbackSupabaseUrl("https://uvolpldwwyvadlamulvr.supabase.co")).toBe(false);
  });
});

describe.skipIf(!INTEGRATION_ENABLED)(
  "V0.3_004A — athlete_coaching_profiles RLS (real local Supabase, two real authenticated users)",
  () => {
    let admin: SupabaseClient;
    let athleteA: SignedInScratchAthlete;
    let athleteB: SignedInScratchAthlete;

    beforeAll(() => {
      admin = createTestClient();
    });

    afterEach(async () => {
      if (athleteA) await deleteTestAthlete(admin, athleteA);
      if (athleteB) await deleteTestAthlete(admin, athleteB);
    });

    it("A can create and read own profile under RLS", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");

      const { error: insertError } = await athleteA.authClient.from("athlete_coaching_profiles").insert({
        athlete_id: athleteA.athleteId,
        technique_primary_focus: "Focus A",
        mental_pre_race_cue: "Cue A",
      });
      expect(insertError).toBeNull();

      const { data, error: readError } = await athleteA.authClient
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus, mental_pre_race_cue")
        .eq("athlete_id", athleteA.athleteId);
      expect(readError).toBeNull();
      expect(data).toEqual([{ technique_primary_focus: "Focus A", mental_pre_race_cue: "Cue A" }]);
    });

    it("A can update own profile under RLS", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");
      await athleteA.authClient
        .from("athlete_coaching_profiles")
        .insert({ athlete_id: athleteA.athleteId, technique_primary_focus: "Original" });

      const { error: updateError } = await athleteA.authClient
        .from("athlete_coaching_profiles")
        .update({ technique_primary_focus: "Updated" })
        .eq("athlete_id", athleteA.athleteId);
      expect(updateError).toBeNull();

      const { data } = await admin
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteA.athleteId)
        .single();
      expect(data?.technique_primary_focus).toBe("Updated");
    });

    it("A cannot SELECT B's profile (RLS silently returns zero rows, never B's data)", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");
      athleteB = await createSignedInScratchAthlete(admin, "RLS test athlete B");

      await admin.from("athlete_coaching_profiles").insert({
        athlete_id: athleteB.athleteId,
        technique_primary_focus: "Focus B — must never leak to A",
      });

      const { data, error } = await athleteA.authClient
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteB.athleteId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("A cannot INSERT a row claiming B's athlete_id", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");
      athleteB = await createSignedInScratchAthlete(admin, "RLS test athlete B");

      const { error } = await athleteA.authClient
        .from("athlete_coaching_profiles")
        .insert({ athlete_id: athleteB.athleteId, technique_primary_focus: "Forged by A" });
      expect(error).not.toBeNull();

      const { data: adminCheck } = await admin
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteB.athleteId);
      expect(adminCheck).toEqual([]);
    });

    it("A cannot UPDATE B's profile", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");
      athleteB = await createSignedInScratchAthlete(admin, "RLS test athlete B");

      await admin
        .from("athlete_coaching_profiles")
        .insert({ athlete_id: athleteB.athleteId, technique_primary_focus: "B original" });

      const { error } = await athleteA.authClient
        .from("athlete_coaching_profiles")
        .update({ technique_primary_focus: "Overwritten by A" })
        .eq("athlete_id", athleteB.athleteId);
      // RLS filters the WHERE clause to zero matching rows rather than
      // returning a permission error — the meaningful assertion is that
      // B's row is provably unchanged, checked via the admin client below.
      expect(error).toBeNull();

      const { data: adminCheck } = await admin
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteB.athleteId)
        .single();
      expect(adminCheck?.technique_primary_focus).toBe("B original");
    });

    it("A cannot DELETE B's profile", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");
      athleteB = await createSignedInScratchAthlete(admin, "RLS test athlete B");

      await admin
        .from("athlete_coaching_profiles")
        .insert({ athlete_id: athleteB.athleteId, technique_primary_focus: "B must survive" });

      const { error } = await athleteA.authClient.from("athlete_coaching_profiles").delete().eq("athlete_id", athleteB.athleteId);
      expect(error).toBeNull();

      const { data: adminCheck } = await admin
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteB.athleteId)
        .single();
      expect(adminCheck?.technique_primary_focus).toBe("B must survive");
    });

    it("symmetric: B cannot SELECT/UPDATE/DELETE A's profile either", async () => {
      athleteA = await createSignedInScratchAthlete(admin, "RLS test athlete A");
      athleteB = await createSignedInScratchAthlete(admin, "RLS test athlete B");

      await admin
        .from("athlete_coaching_profiles")
        .insert({ athlete_id: athleteA.athleteId, technique_primary_focus: "A must survive" });

      const { data: selectData, error: selectError } = await athleteB.authClient
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteA.athleteId);
      expect(selectError).toBeNull();
      expect(selectData).toEqual([]);

      await athleteB.authClient
        .from("athlete_coaching_profiles")
        .update({ technique_primary_focus: "Overwritten by B" })
        .eq("athlete_id", athleteA.athleteId);
      await athleteB.authClient.from("athlete_coaching_profiles").delete().eq("athlete_id", athleteA.athleteId);

      const { data: adminCheck } = await admin
        .from("athlete_coaching_profiles")
        .select("technique_primary_focus")
        .eq("athlete_id", athleteA.athleteId)
        .single();
      expect(adminCheck?.technique_primary_focus).toBe("A must survive");
    });
  }
);
