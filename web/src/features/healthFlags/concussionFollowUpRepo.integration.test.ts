/**
 * SPORT-SAFE-02 A5 (HPM 2026-10-22) — the rider's concussion follow-up repo on the real local Supabase (opt-in,
 * local only, migration 20261021200000 applied): the web client signed in as the rider reads its own signal and
 * attestations under RLS and records a declarative attestation through record_health_flag_attestation.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient } from "../../../../head-coach-engine/tests/supabase/testDb.js";
import { integrationApiUrl } from "../../test/testTarget";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const LOCAL_URL = integrationApiUrl();
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && !!LOCAL_ANON_KEY && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(LOCAL_URL);
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe.skipIf(!INTEGRATION_ENABLED)("SPORT-SAFE-02 A5 — concussion follow-up repo (real local Supabase, rider JWT)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let repo: typeof import("./concussionFollowUpRepo");
  let athleteId: string;
  let strangerFlag: string;

  const openConcussion = async (owner: string) => {
    const { data, error } = await admin
      .from("health_flags")
      .insert({ athlete_id: owner, flag_date: TODAY, flag_type: "concussion_suspect", status: "active", description: "Suspicion de commotion déclarée au checkin" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  };

  beforeAll(async () => {
    admin = createTestClient();
    vi.stubEnv("VITE_SUPABASE_URL", LOCAL_URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", LOCAL_ANON_KEY!);
    vi.resetModules();
    ({ supabase: userClient } = await import("../../lib/supabase"));
    repo = await import("./concussionFollowUpRepo");
    const { data: installed } = await admin.from("health_flag_attestations").select("id").limit(1);
    if (installed === null) throw new Error("A5 migration not applied to the local stack");

    const athlete = await createTestAthlete(admin, "A5 web follow-up");
    athleteId = athlete.athleteId;
    const stranger = await createTestAthlete(admin, "A5 web follow-up stranger");
    strangerFlag = await openConcussion(stranger.athleteId);
    const { data: user } = await admin.auth.admin.getUserById(athlete.userId);
    const password = `Sc${randomUUID().replace(/-/g, "").slice(0, 20)}Aa1!`;
    await admin.auth.admin.updateUserById(athlete.userId, { password });
    const { error } = await userClient.auth.signInWithPassword({ email: user.user!.email!, password });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  }, 90_000);

  afterAll(async () => {
    await userClient?.auth.signOut();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads the current server state; « in progress » keeps the signal open; a replay is idempotent; the same id with another content conflicts; a dated full return closes it", async () => {
    const flagId = await openConcussion(athleteId);
    const steps: Record<string, unknown> = {};
    steps.initial = await repo.loadConcussionFollowUp(flagId);
    const inProgress = { id: randomUUID(), flagId, outcome: "assessment_in_progress" as const, assessedOn: null, professionalCategory: null, enteredInErrorConfirmation: false };
    steps.inProgress = await repo.recordConcussionAttestation(inProgress);
    steps.replay = await repo.recordConcussionAttestation(inProgress);
    steps.conflict = await repo.recordConcussionAttestation({ ...inProgress, outcome: "concussion_confirmed", assessedOn: TODAY });
    steps.afterInProgress = await repo.loadConcussionFollowUp(flagId);
    steps.error = await repo.recordConcussionAttestation({ id: randomUUID(), flagId, outcome: "entered_in_error", assessedOn: null, professionalCategory: null, enteredInErrorConfirmation: true });
    steps.fullReturn = await repo.recordConcussionAttestation({ id: randomUUID(), flagId, outcome: "full_return_authorised", assessedOn: TODAY, professionalCategory: "sports_physician", enteredInErrorConfirmation: false });
    steps.final = await repo.loadConcussionFollowUp(flagId);
    expect(steps).toEqual({
      initial: { open: true, flagDate: TODAY, lastOutcome: null },
      inProgress: { ok: true, closed: false },
      replay: { ok: true, closed: false },
      conflict: { ok: false, code: "id_conflict", retryable: false },
      afterInProgress: { open: true, flagDate: TODAY, lastOutcome: "assessment_in_progress" },
      error: { ok: false, code: "entered_in_error_after_assessment", retryable: false },
      fullReturn: { ok: true, closed: true },
      final: { open: false, flagDate: TODAY, lastOutcome: "full_return_authorised" },
    });
  });

  it("another rider's signal: neither readable nor attestable (RLS, athlete from the JWT)", async () => {
    await expect(repo.loadConcussionFollowUp(strangerFlag)).rejects.toBeInstanceOf(repo.ConcussionFollowUpLoadError);
    expect(await repo.recordConcussionAttestation({ id: randomUUID(), flagId: strangerFlag, outcome: "ruled_out", assessedOn: TODAY, professionalCategory: null, enteredInErrorConfirmation: false })).toEqual({
      ok: false,
      code: "flag_not_found",
      retryable: false,
    });
    const { data } = await admin.from("health_flags").select("status").eq("id", strangerFlag).single();
    expect(data!.status).toBe("active");
  });

  it("the rider cannot write the attestations table directly, nor close the signal by an update", async () => {
    const flagId = await openConcussion(athleteId);
    const insert = await userClient.from("health_flag_attestations").insert({ id: randomUUID(), flag_id: flagId, athlete_id: athleteId, outcome: "ruled_out", assessed_on: TODAY });
    await userClient.from("health_flags").update({ status: "resolved" }).eq("id", flagId);
    const { data } = await admin.from("health_flags").select("status").eq("id", flagId).single();
    expect([insert.error ? "refused" : "accepted", data!.status]).toEqual(["refused", "active"]);
  });
});
