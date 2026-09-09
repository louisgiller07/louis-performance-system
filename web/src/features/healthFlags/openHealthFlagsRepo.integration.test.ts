/// <reference types="node" />
/**
 * V0.3_006A1 — real local Supabase security matrix for the
 * 20260909090000_v0_3_006a1_health_flags_select_only_security migration.
 * Proves the exact contract the investigation required: an authenticated
 * athlete can SELECT their own open health_flags rows and nothing else — no
 * direct INSERT/UPDATE/DELETE, on their own row or another athlete's — while
 * the privileged (service_role) path daily-run relies on is untouched.
 *
 * Same opt-in/loopback-safety-gate discipline as
 * web/src/features/planning/planningRepo.integration.test.ts (this file's
 * direct model) — see that file's header comment for the full rationale.
 * Duplicated here rather than shared, matching that file's own
 * self-contained precedent.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestClient, deleteTestAthlete, type TestAthlete } from "../../../../head-coach-engine/tests/supabase/testDb.js";

export function isLoopbackSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

export function computeIntegrationEnabled(optInFlag: string | undefined, serverKey: string | undefined, resolvedAdminUrl: string): boolean {
  return optInFlag === "1" && !!serverKey && isLoopbackSupabaseUrl(resolvedAdminUrl);
}

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESOLVED_ADMIN_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const INTEGRATION_ENABLED = computeIntegrationEnabled(process.env.RUN_LOCAL_SUPABASE_INTEGRATION, SERVER_KEY, RESOLVED_ADMIN_URL);

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

interface SignedInTestAthlete extends TestAthlete {
  email: string;
  password: string;
}

async function createSignedInTestAthlete(admin: SupabaseClient, name: string): Promise<SignedInTestAthlete> {
  const athleteId = crypto.randomUUID();
  const email = `v0.3_006a1-health-flags-test-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomUUID();

  const { data: userData, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !userData.user) {
    throw new Error(`createSignedInTestAthlete: auth user creation failed: ${userError?.message}`);
  }
  const userId = userData.user.id;

  const { error: athleteError } = await admin.from("athletes").insert({ id: athleteId, user_id: userId, name });
  if (athleteError) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`createSignedInTestAthlete: athletes insert failed: ${athleteError.message}`);
  }

  return { athleteId, userId, email, password };
}

describe.skipIf(!INTEGRATION_ENABLED)("health_flags — real local Supabase RLS/grant security matrix (V0.3_006A1)", () => {
  let admin: SupabaseClient;
  let athleteA: SignedInTestAthlete;
  let athleteB: SignedInTestAthlete;
  let repo: typeof import("./openHealthFlagsRepo");
  let userClient: SupabaseClient;

  beforeAll(async () => {
    admin = createTestClient();
    athleteA = await createSignedInTestAthlete(admin, "V0.3_006A1 health_flags RLS test athlete A");
    athleteB = await createSignedInTestAthlete(admin, "V0.3_006A1 health_flags RLS test athlete B");

    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY);
    vi.resetModules();
    repo = await import("./openHealthFlagsRepo");
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

  async function seedOpenFlag(athlete: SignedInTestAthlete, flagType: string, flagDate: string): Promise<string> {
    const { data, error } = await admin
      .from("health_flags")
      .insert({ athlete_id: athlete.athleteId, flag_type: flagType, flag_date: flagDate, description: "seed", status: "active" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seedOpenFlag failed: ${error?.message}`);
    return data.id as string;
  }

  it("A. privileged (service_role/admin) path can still create a health flag — the persist_daily_run precondition", async () => {
    const id = await seedOpenFlag(athleteA, "concussion_suspect", "2026-09-05");
    expect(id).toEqual(expect.any(String));

    const { data } = await admin.from("health_flags").select("id, status").eq("id", id).single();
    expect(data?.status).toBe("active");
  });

  it("B. A can SELECT their own open flag via the authenticated repo", async () => {
    await signInAs(athleteA);
    const flags = await repo.loadOpenHealthFlags(athleteA.athleteId);
    expect(flags).toEqual([{ type: "concussion_suspect", flagDate: "2026-09-05" }]);
  });

  it("C. A cannot SELECT B's health flags (RLS filters silently, empty result, no error)", async () => {
    await seedOpenFlag(athleteB, "illness", "2026-09-06");

    await signInAs(athleteA);
    const flags = await repo.loadOpenHealthFlags(athleteB.athleteId);
    expect(flags).toEqual([]);
  });

  it("D. A cannot directly INSERT a health flag for their own athlete_id via PostgREST", async () => {
    await signInAs(athleteA);
    const { error } = await userClient
      .from("health_flags")
      .insert({ athlete_id: athleteA.athleteId, flag_type: "illness", flag_date: "2026-09-07", description: "forged", status: "active" });
    expect(error).not.toBeNull();
  });

  it("E. A cannot directly UPDATE their own open flag to resolved via PostgREST (the exact issue this migration closes)", async () => {
    await signInAs(athleteA);
    const { data: ownFlags } = await admin
      .from("health_flags")
      .select("id")
      .eq("athlete_id", athleteA.athleteId)
      .eq("flag_type", "concussion_suspect");
    const flagId = ownFlags?.[0]?.id as string;

    const { error } = await userClient.from("health_flags").update({ status: "resolved" }).eq("id", flagId);
    expect(error).not.toBeNull();

    const { data: after } = await admin.from("health_flags").select("status").eq("id", flagId).single();
    expect(after?.status).toBe("active");
  });

  it("F. A cannot directly DELETE their own open flag via PostgREST", async () => {
    await signInAs(athleteA);
    const { data: ownFlags } = await admin
      .from("health_flags")
      .select("id")
      .eq("athlete_id", athleteA.athleteId)
      .eq("flag_type", "concussion_suspect");
    const flagId = ownFlags?.[0]?.id as string;

    const { error } = await userClient.from("health_flags").delete().eq("id", flagId);
    expect(error).not.toBeNull();

    const { data: after } = await admin.from("health_flags").select("id").eq("id", flagId).maybeSingle();
    expect(after?.id).toBe(flagId);
  });

  it("G. A cannot write B's health flag (INSERT into B's athlete_id, or UPDATE/DELETE B's row)", async () => {
    const { data: bFlags } = await admin.from("health_flags").select("id").eq("athlete_id", athleteB.athleteId).eq("flag_type", "illness");
    const bFlagId = bFlags?.[0]?.id as string;

    await signInAs(athleteA);

    const insertResult = await userClient
      .from("health_flags")
      .insert({ athlete_id: athleteB.athleteId, flag_type: "illness", flag_date: "2026-09-08", description: "forged for B", status: "active" });
    expect(insertResult.error).not.toBeNull();

    const updateResult = await userClient.from("health_flags").update({ status: "resolved" }).eq("id", bFlagId);
    expect(updateResult.error).not.toBeNull();

    const deleteResult = await userClient.from("health_flags").delete().eq("id", bFlagId);
    expect(deleteResult.error).not.toBeNull();

    const { data: after } = await admin.from("health_flags").select("status").eq("id", bFlagId).single();
    expect(after?.status).toBe("active");
  });

  it("H. B has the exact same protections as A (SELECT own only, no direct writes)", async () => {
    await signInAs(athleteB);

    const ownFlags = await repo.loadOpenHealthFlags(athleteB.athleteId);
    expect(ownFlags).toEqual([{ type: "illness", flagDate: "2026-09-06" }]);

    const aFlags = await repo.loadOpenHealthFlags(athleteA.athleteId);
    expect(aFlags).toEqual([]);

    const insertResult = await userClient
      .from("health_flags")
      .insert({ athlete_id: athleteB.athleteId, flag_type: "pain_persistent", flag_date: "2026-09-09", description: "forged", status: "active" });
    expect(insertResult.error).not.toBeNull();
  });

  it("I. privileged path dedup/reuse (health_flags_open_unique) is still enforced after the RLS/grant change", async () => {
    await expect(seedOpenFlag(athleteA, "concussion_suspect", "2026-09-10")).rejects.toThrow();
  });
});
