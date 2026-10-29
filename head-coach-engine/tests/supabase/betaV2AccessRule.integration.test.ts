/**
 * BETA-V2-TECH-01 B (HPM 2026-10-28, candidate) — the beta access rule on the generate-training-plan Edge Function itself
 * (local runtime, the rider's JWT), for the runtime configuration named by NALYNT_TEST_EDGE_V2_MODE ("off", "on_unsigned",
 * "on_test_signed"; the harness serves it, this file never changes it):
 * - no assignment → 403 beta_access_not_granted, whatever the switch; nothing written; never V1 by default;
 * - explicit v1 assignment (test accounts) → a V1 plan, whatever the switch;
 * - v2 assignment → off: 503 v2_generation_disabled; on_unsigned: 422 dh_repetition_unit_unknown (the V2 path, never V1);
 *   on_test_signed: a V2 plan;
 * - the body cannot choose the model; a rider cannot write any assignment;
 * - an unreadable assignment → 503 beta_access_check_unavailable, nothing written.
 * Opt-in: RUN_LOCAL_P0_EDGE=1 and NALYNT_TEST_EDGE_V2_MODE set.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { FunctionsHttpError, SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";

const MODE = process.env.NALYNT_TEST_EDGE_V2_MODE;
const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1" && MODE !== undefined;

describe.skipIf(!ENABLED)(`BETA-V2-TECH-01 B — beta access rule over HTTP, runtime "${MODE}"`, { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  /** A rider ready for a V2 plan (profile, DH tier, terrains, availability), with the given assignment (or none). */
  async function rider(label: string, model: "v1" | "v2" | null) {
    const a = await createTestAthlete(admin, `beta access ${MODE} ${label} ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, a.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, a.athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "root_rock_trail", "technical_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["roots_rocks"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, a.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    if (model) execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note, decided_by) values (${lit(a.athleteId)}, '${model}', 'BETA-V2-TECH-01 B test account', 'TEST operator (not a real decision)');`);
    return { athleteId: a.athleteId, client: await getAthleteAuthClient(a.athleteId) };
  }
  type Answer = { status: number; body: { error?: { code?: string } } & Record<string, unknown> };
  async function generate(client: SupabaseClient, extra: Record<string, unknown> = {}): Promise<Answer> {
    const { data, error } = await client.functions.invoke("generate-training-plan", { body: { generationRequestId: randomUUID(), durationWeeks: 2, ...extra } });
    if (!error) return { status: 200, body: data as Answer["body"] };
    const response = (error as FunctionsHttpError).context as Response;
    return { status: response.status, body: (await response.json()) as Answer["body"] };
  }
  const versions = (athleteId: string) => execLocalSql(`select count(*) from public.training_plan_versions where athlete_id = ${lit(athleteId)};`).trim();
  const schemaOf = (planVersionId: string) => execLocalSql(`select prescription_schema_version from public.training_plan_versions where id = ${lit(planVersionId)};`).trim();
  const lastEvent = (athleteId: string) =>
    JSON.parse(execLocalSql(`select coalesce((select jsonb_build_object('event_type', event_type) || metadata from public.pilot_observability_events where athlete_id = ${lit(athleteId)} and event_type like 'plan_generation_%' order by created_at desc limit 1), 'null'::jsonb);`).trim()) as Record<string, unknown> | null;

  it("no assignment → 403 beta_access_not_granted, nothing written, never V1; the refusal is traced without a model", async () => {
    const r = await rider("none", null);
    const out = await generate(r.client);
    expect([out.status, out.body.error?.code, versions(r.athleteId)]).toEqual([403, "beta_access_not_granted", "0"]);
    expect(lastEvent(r.athleteId)).toEqual({ event_type: "plan_generation_blocked", blockedReason: "beta_access_not_granted", rolloutReason: "not_assigned" });
  });

  it("a rider cannot grant itself the access: every write to the assignments is refused, and the generation stays refused", async () => {
    const r = await rider("self-grant", null);
    const insert = await r.client.from("training_plan_model_assignments").insert({ athlete_id: r.athleteId, planning_model: "v2", note: "self" });
    const read = await r.client.from("training_plan_model_assignments").select("*");
    expect([insert.error?.code, read.error?.code]).toEqual(["42501", "42501"]);
    expect(execLocalSql(`select count(*) from public.training_plan_model_assignments where athlete_id = ${lit(r.athleteId)};`).trim()).toBe("0");
    for (const forged of [{ planningModel: "v2" }, { planningModel: "v1" }, { assignment: "v2" }, { betaAccess: true }]) {
      const out = await generate(r.client, forged);
      expect([out.status, out.body.error?.code], JSON.stringify(forged)).toEqual([400, "invalid_request"]);
    }
    expect((await generate(r.client)).status).toBe(403);
    expect(versions(r.athleteId)).toBe("0");
  });

  it("explicit v1 exemption → a V1 plan, whatever the switch; the response never reveals the model", async () => {
    const r = await rider("v1", "v1");
    const out = await generate(r.client);
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(["idempotentReplay", "planVersionId"]);
    expect(schemaOf(out.body.planVersionId as string)).toBe("v1");
    expect(lastEvent(r.athleteId)).toMatchObject({ event_type: "plan_generation_succeeded", planningModel: "v1", rolloutReason: "assigned_v1" });
  });

  it.runIf(MODE === "off")("v2 assignment, V2 OFF → 503 v2_generation_disabled, nothing written (never V1)", async () => {
    const r = await rider("v2 off", "v2");
    const out = await generate(r.client);
    expect([out.status, out.body.error?.code, versions(r.athleteId)]).toEqual([503, "v2_generation_disabled", "0"]);
  });

  it.runIf(MODE === "on_unsigned")("v2 assignment, V2 ON without signed units → 422 dh_repetition_unit_unknown: the V2 path, never V1", async () => {
    const r = await rider("v2 on unsigned", "v2");
    const out = await generate(r.client);
    expect([out.status, out.body.error?.code, versions(r.athleteId)]).toEqual([422, "dh_repetition_unit_unknown", "0"]);
    expect(lastEvent(r.athleteId)).toMatchObject({ planningModel: "v2", rolloutReason: "assigned_v2" });
  });

  it.runIf(MODE === "on_test_signed")("v2 assignment, V2 ON with TEST sign-offs → a V2 plan", async () => {
    const r = await rider("v2 on signed", "v2");
    const out = await generate(r.client);
    expect(out.status).toBe(200);
    expect(schemaOf(out.body.planVersionId as string)).toBe("v2");
  });

  // The assignment read is made unreadable for the service role on this DISPOSABLE stack only, then restored.
  it("an unreadable assignment → 503 beta_access_check_unavailable, nothing written, neither V1 nor V2", async () => {
    const r = await rider("unreadable", "v2");
    execLocalSql("revoke select on public.training_plan_model_assignments from service_role;");
    let out: Answer;
    try {
      out = await generate(r.client);
    } finally {
      execLocalSql("grant select on public.training_plan_model_assignments to service_role;");
    }
    expect([out.status, out.body.error?.code, versions(r.athleteId)]).toEqual([503, "beta_access_check_unavailable", "0"]);
    expect(execLocalSql("select has_table_privilege('service_role', 'public.training_plan_model_assignments', 'select');").trim()).toBe("t");
  });
});
