/**
 * V0.3_004B — real local Supabase RLS proof for athlete self-bootstrap
 * (`createOwnAthlete`). Mirrors the exact established pattern from
 * web/src/features/planning/planningRepo.integration.test.ts: real
 * signed-in Supabase sessions exercising RLS directly (never the
 * service_role admin client for the writes under test), hard-bound to
 * loopback, opt-in only.
 *
 * Unlike planningRepo's fixtures, the scratch auth users here are created
 * WITHOUT an athletes row — that row's creation is exactly the behavior
 * under test.
 *
 * OPT-IN ONLY — a normal `npm test` in web/ must stay self-contained and
 * must never require a running local Supabase stack. Skipped unless ALL of:
 *   RUN_LOCAL_SUPABASE_INTEGRATION=1
 *   SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is set
 *   SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY) is set
 *   the admin client's resolved URL is explicitly loopback-local
 * A missing opt-in, a missing key, or a non-loopback resolved URL all show
 * up as SKIPPED, never a silent pass or a hard failure. No key — including
 * the well-known local-dev anon key — is ever hardcoded in this file.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestClient, insertCheckin } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { runDailyFor } from "../../../../head-coach-engine/src/supabase/runDailyFor.js";

export function isLoopbackSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

export function computeIntegrationEnabled(
  optInFlag: string | undefined,
  serverKey: string | undefined,
  resolvedAdminUrl: string
): boolean {
  return optInFlag === "1" && !!serverKey && isLoopbackSupabaseUrl(resolvedAdminUrl);
}

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const RESOLVED_ADMIN_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// computeIntegrationEnabled's tested contract (below) covers opt-in/server-
// key/loopback only, matching every other integration suite in this repo —
// the publishable-key requirement is ANDed in separately here rather than
// widening that shared function's signature.
const INTEGRATION_ENABLED =
  computeIntegrationEnabled(process.env.RUN_LOCAL_SUPABASE_INTEGRATION, SERVER_KEY, RESOLVED_ADMIN_URL) &&
  !!LOCAL_ANON_KEY;

describe("athleteBootstrapRepo integration — local-target safety gate (always-on, no network)", () => {
  it("rejects the real production Supabase project URL", () => {
    expect(isLoopbackSupabaseUrl("https://uvolpldwwyvadlamulvr.supabase.co")).toBe(false);
  });

  it("stays disabled against the real production project URL even with opt-in and a key", () => {
    expect(computeIntegrationEnabled("1", "some-key", "https://uvolpldwwyvadlamulvr.supabase.co")).toBe(false);
  });
});

const LOCAL_URL = "http://127.0.0.1:54321";

interface ScratchAuthUser {
  userId: string;
  email: string;
  password: string;
}

/** Creates ONLY the auth user — deliberately no athletes row. Athlete creation is the behavior under test. */
async function createScratchAuthUser(admin: SupabaseClient): Promise<ScratchAuthUser> {
  const email = `v0.3_004b-bootstrap-test-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createScratchAuthUser failed: ${error?.message}`);
  return { userId: data.user.id, email, password };
}

async function cleanupScratchUser(admin: SupabaseClient, user: ScratchAuthUser): Promise<void> {
  await admin.from("athletes").delete().eq("user_id", user.userId);
  await admin.auth.admin.deleteUser(user.userId);
}

describe.skipIf(!INTEGRATION_ENABLED)("V0.3_004B — athlete bootstrap RLS (real local Supabase, two real authenticated users)", () => {
  let admin: SupabaseClient;
  let repo: typeof import("./athleteBootstrapRepo");
  let userClient: SupabaseClient;
  let userA: ScratchAuthUser;
  let userB: ScratchAuthUser;

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    // Non-null: this block only ever runs when INTEGRATION_ENABLED is true,
    // which already requires !!LOCAL_ANON_KEY (see the gate above) — never
    // reached with an absent key.
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    repo = await import("./athleteBootstrapRepo");
    ({ supabase: userClient } = await import("../../lib/supabase"));
  });

  afterAll(async () => {
    await userClient.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(async () => {
    if (userA) await cleanupScratchUser(admin, userA);
    if (userB) await cleanupScratchUser(admin, userB);
  });

  async function signInAs(user: ScratchAuthUser): Promise<void> {
    const { error } = await userClient.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error) throw new Error(`signInAs failed: ${error.message}`);
  }

  it("A can create and read own athlete row via the real repository function", async () => {
    userA = await createScratchAuthUser(admin);
    await signInAs(userA);

    await repo.createOwnAthlete(userA.userId, "RLS bootstrap test athlete A");

    const { data, error } = await userClient.from("athletes").select("user_id, name").eq("user_id", userA.userId);
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: userA.userId, name: "RLS bootstrap test athlete A" }]);
  });

  it("A cannot create an athlete row for B's user_id — RLS rejects it regardless of what the client sends", async () => {
    userA = await createScratchAuthUser(admin);
    userB = await createScratchAuthUser(admin);
    await signInAs(userA);

    await expect(repo.createOwnAthlete(userB.userId, "Forged by A")).rejects.toThrow(repo.AthleteBootstrapError);

    const { data: adminCheck } = await admin.from("athletes").select("user_id").eq("user_id", userB.userId);
    expect(adminCheck).toEqual([]);
  });

  it("A cannot read B's athlete row (RLS filters it out, never an error, never B's data)", async () => {
    userA = await createScratchAuthUser(admin);
    userB = await createScratchAuthUser(admin);
    await admin.from("athletes").insert({ user_id: userB.userId, name: "Athlete B — must never leak to A" });

    await signInAs(userA);
    const { data, error } = await userClient.from("athletes").select("user_id, name").eq("user_id", userB.userId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a second own-athlete insert for the same already-bootstrapped user fails on UNIQUE(user_id) — never a duplicate row", async () => {
    userA = await createScratchAuthUser(admin);
    await signInAs(userA);

    await repo.createOwnAthlete(userA.userId, "First athlete row for A");
    await expect(repo.createOwnAthlete(userA.userId, "Second attempt for A")).rejects.toThrow(repo.AthleteBootstrapError);

    const { data: adminCheck } = await admin.from("athletes").select("name").eq("user_id", userA.userId);
    expect(adminCheck).toHaveLength(1);
    expect(adminCheck?.[0]?.name).toBe("First athlete row for A");
  });

  // §23/§24 — mandatory first-use reachability check: what can a freshly
  // bootstrapped athlete (athlete row only, nothing else) actually reach?
  describe("first-use reachability after bootstrap (no other rows exist)", () => {
    it("checkin load, Planning load, and history load all resolve to empty/null — no crash, no manual DB intervention needed", async () => {
      userA = await createScratchAuthUser(admin);
      await signInAs(userA);
      await repo.createOwnAthlete(userA.userId, "Fresh athlete — reachability check");

      const { data: athleteRow } = await userClient.from("athletes").select("id").eq("user_id", userA.userId).single();
      const athleteId = athleteRow!.id as string;

      const checkinRepo = await import("../checkin/checkinRepo");
      const planningRepo = await import("../planning/planningRepo");
      const historyRepo = await import("../history/historyRepo");

      await expect(checkinRepo.loadCheckin(athleteId, "2026-09-04")).resolves.toBeNull();
      await expect(planningRepo.loadPlannedSessions(athleteId, "2026-09-04", "2026-09-10")).resolves.toEqual([]);
      await expect(historyRepo.loadDecisionHistory(athleteId)).resolves.toEqual([]);
    });

    it("V0.3_004C — daily-run (real engine, direct runDailyFor call) succeeds for a fresh athlete with a checkin but no current training_blocks row: active_mode=UNSPECIFIED, never an error, never a fabricated training_blocks row", async () => {
      userA = await createScratchAuthUser(admin);
      await signInAs(userA);
      await repo.createOwnAthlete(userA.userId, "Fresh athlete — daily-run reachability check");

      const { data: athleteRow } = await userClient.from("athletes").select("id").eq("user_id", userA.userId).single();
      const athleteId = athleteRow!.id as string;

      // Isolate exactly the training_blocks variable: give this athlete a
      // real, known-good neutral checkin (same sanctioned fixture helper
      // used throughout head-coach-engine's own integration suite) so the
      // only remaining unconfigured prerequisite is the training block.
      await insertCheckin(admin, athleteId, "2026-09-04");

      const { data: blocksBefore } = await admin.from("training_blocks").select("id").eq("athlete_id", athleteId);
      expect(blocksBefore).toEqual([]);

      const result = await runDailyFor(admin, athleteId, "2026-09-04");
      expect(result.dailyPlan.active_mode).toBe("UNSPECIFIED");

      const { data: decisionRow } = await admin
        .from("decisions")
        .select("active_mode")
        .eq("id", result.persistence.decision_id)
        .single();
      expect(decisionRow?.active_mode).toBe("UNSPECIFIED");

      const { data: blocksAfter } = await admin.from("training_blocks").select("id").eq("athlete_id", athleteId);
      expect(blocksAfter).toEqual([]);
    });
  });
});
