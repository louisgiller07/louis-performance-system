import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import {
  createTestClient,
  createTestAthlete,
  deleteTestAthlete,
  getAthleteAuthClient,
  insertCheckin,
  insertTrainingBlock,
  isLoopbackSupabaseUrl,
  resolveTestSupabaseUrl,
  type TestAthlete,
} from "./testDb.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED =
  process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

/**
 * V0.3.013 — PILOT-BLOCK-002. Strengthens the existing single-neutral-day
 * proof (runDailyFor.longitudinal.integration.test.ts) with SEVERAL
 * consecutive neutral check-in days before resolution, per the ticket's
 * explicit "plusieurs jours avec check-in normal" requirement. No runtime
 * code change for this scenario — investigation confirmed rules/safety.ts
 * (A1/A5) already treats an unresolved concussion_suspect flag as a
 * persistent hard block with no time-based expiry, and no code path in the
 * repo ever writes health_flags.status='resolved' automatically. This test
 * only adds proof depth: the block must survive an arbitrary number of
 * ordinary days, not just one, and must never clear itself — only an
 * explicit external write (the same privileged DB action a real medical
 * validation workflow would perform) can close it.
 */
describe.skipIf(!INTEGRATION_ENABLED)("T21 — concussion signal survives multiple neutral days, closes only on explicit resolution (V0.3.013)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "T21 concussion multi-day test athlete");
    await insertTrainingBlock(client, athlete.athleteId, "IN_SEASON");
  });

  afterEach(async () => {
    await deleteTestAthlete(client, athlete);
  });

  async function countOpenConcussionFlags(): Promise<number> {
    const { data } = await client
      .from("health_flags")
      .select("id")
      .eq("athlete_id", athlete.athleteId)
      .eq("flag_type", "concussion_suspect")
      .in("status", ["active", "monitoring"]);
    return data?.length ?? 0;
  }

  it("creation -> 3 consecutive neutral check-in days (signal stays active, A5 fires every day) -> explicit external validation -> closure -> normal prescription returns", async () => {
    const dayN = "2026-08-16";
    const dayN1 = "2026-08-17";
    const dayN2 = "2026-08-18";
    const dayN3 = "2026-08-19";
    const dayN4 = "2026-08-20";

    // --- Day N: A1 creates the signal ---
    await insertCheckin(client, athlete.athleteId, dayN, { suspected_concussion: true });
    const runN = await runDailyFor(client, athlete.athleteId, dayN);
    expect(runN.dailyPlan.decision).toBe("REST");
    expect(runN.dailyPlan.triggered_rules.some((r) => r.rule_id === "A1")).toBe(true);
    const flagId = runN.persistence.health_flag_id!;
    expect(flagId).toEqual(expect.any(String));
    expect(await countOpenConcussionFlags()).toBe(1);

    // --- Days N+1, N+2, N+3: three CONSECUTIVE ordinary/neutral check-ins.
    // Never "check-in OK -> suppression automatique": the flag must remain
    // active and A5 (SPORT-SAFE-02: a Safety REST, every family suspended) must fire EVERY single one of these days,
    // never just the first, proving there is no time-based decay. ---
    for (const day of [dayN1, dayN2, dayN3]) {
      await insertCheckin(client, athlete.athleteId, day);
      const run = await runDailyFor(client, athlete.athleteId, day);

      expect(run.dailyPlan.triggered_rules.some((r) => r.rule_id === "A5")).toBe(true);
      expect([run.dailyPlan.decision, run.dailyPlan.final_session.kind]).toEqual(["REST", "REST"]);
      expect(run.dailyPlan.protection.do_not_do).toContain(
        "Pas d'entraînement proposé par NALYNT tant que le suivi post-commotion est ouvert",
      );
      // No new flag is ever (re)created by an ordinary neutral day — A5 is
      // read-only continuity of the SAME still-open flag.
      expect(run.dailyPlan.health_flag_to_create).toBeUndefined();
      expect(await countOpenConcussionFlags()).toBe(1);
    }

    // --- Explicit external validation. SPORT-SAFE-02 A5-P0: a concussion signal is closed ONLY by the rider's
    // declarative attestation (record_health_flag_attestation) — a privileged direct write is now refused. ---
    const { error: directError } = await client.from("health_flags").update({ status: "resolved", resolved_at: dayN3 }).eq("id", flagId);
    expect(directError?.message).toBe("concussion_resolution_requires_attestation");
    const rider = await getAthleteAuthClient(athlete.athleteId);
    const { data: attested, error: resolveError } = await rider.rpc("record_health_flag_attestation", {
      p_attestation: { id: crypto.randomUUID(), flag_id: flagId, outcome: "full_return_authorised", assessed_on: dayN3 },
    });
    expect(resolveError).toBeNull();
    expect(attested).toMatchObject({ status: "recorded", flag_status: "resolved" });
    expect(await countOpenConcussionFlags()).toBe(0);

    // --- Day N+4: normal prescription returns — A5 no longer fires ---
    await insertCheckin(client, athlete.athleteId, dayN4);
    const runN4 = await runDailyFor(client, athlete.athleteId, dayN4);
    expect(runN4.dailyPlan.triggered_rules.some((r) => r.rule_id === "A5")).toBe(false);
    expect(runN4.dailyPlan.protection.do_not_do).not.toContain(
      "Pas d'entraînement proposé par NALYNT tant que le suivi post-commotion est ouvert",
    );
  });
});
