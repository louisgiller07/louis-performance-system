import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { createTestClient, createTestAthlete, deleteTestAthlete, insertCheckin, insertTrainingBlock, type TestAthlete } from "./testDb.js";

describe("M2 write path — longitudinal A1 → A5 → resolution (integration, real M1 engine + real DB + real runDailyFor)", () => {
  let client: SupabaseClient;
  let athlete: TestAthlete;

  beforeEach(async () => {
    client = createTestClient();
    athlete = await createTestAthlete(client, "longitudinal A1-A5 test athlete");
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

  async function countDecisions(): Promise<number> {
    const { data } = await client.from("decisions").select("id").eq("athlete_id", athlete.athleteId);
    return data?.length ?? 0;
  }

  it("proves the full longitudinal loop: M1 A1 → persisted health_flag → next-day read path → M1 A5 → resolution clears A5", async () => {
    const dayN = "2026-08-16";
    const dayN1 = "2026-08-17";
    const dayN2 = "2026-08-18";

    // --- Day N: A1 (suspected concussion) ---
    await insertCheckin(client, athlete.athleteId, dayN, { suspected_concussion: true });
    const runN = await runDailyFor(client, athlete.athleteId, dayN);

    expect(runN.dailyPlan.decision).toBe("REST");
    expect(runN.dailyPlan.triggered_rules.some((r) => r.rule_id === "A1")).toBe(true);
    expect(runN.dailyPlan.health_flag_to_create).toEqual({
      type: "concussion_suspect",
      reason: expect.any(String),
    });
    expect(runN.persistence.health_flag_id).toEqual(expect.any(String));

    expect(await countOpenConcussionFlags()).toBe(1);
    expect(await countDecisions()).toBe(1);

    // --- Day N+1: neutral checkin, no new concussion signal — A5 must activate from the persisted flag ---
    await insertCheckin(client, athlete.athleteId, dayN1);
    const runN1 = await runDailyFor(client, athlete.athleteId, dayN1);

    const a5Rule = runN1.dailyPlan.triggered_rules.find((r) => r.rule_id === "A5");
    expect(a5Rule).toBeDefined();
    expect(runN1.dailyPlan.protection.do_not_do).toContain(
      "Aucune activité DH tant que la validation médicale post-commotion n'est pas obtenue"
    );

    // No duplicate flag — A5 is read-only continuity, not a new health_flag_to_create.
    expect(runN1.dailyPlan.health_flag_to_create).toBeUndefined();
    expect(await countOpenConcussionFlags()).toBe(1);
    expect(await countDecisions()).toBe(2);

    // --- Resolve the flag (explicit fixture/test DB action, not an applicative repository) ---
    const { error: resolveError } = await client
      .from("health_flags")
      .update({ status: "resolved", resolved_at: dayN1 })
      .eq("id", runN.persistence.health_flag_id!);
    expect(resolveError).toBeNull();
    expect(await countOpenConcussionFlags()).toBe(0);

    // --- Day N+2: neutral checkin again — A5 must no longer trigger from the resolved flag ---
    await insertCheckin(client, athlete.athleteId, dayN2);
    const runN2 = await runDailyFor(client, athlete.athleteId, dayN2);

    expect(runN2.dailyPlan.triggered_rules.some((r) => r.rule_id === "A5")).toBe(false);
    expect(await countDecisions()).toBe(3);
  });
});
