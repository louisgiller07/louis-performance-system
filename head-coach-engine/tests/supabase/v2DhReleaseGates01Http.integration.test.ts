/**
 * V2-DH-RELEASE-GATES-01 (HPM 2026-10-26) — the generate-training-plan contract over HTTP (local Edge runtime, the
 * rider's JWT), for the three runtime configurations, on a disposable local stack. NALYNT_TEST_EDGE_V2_MODE names the
 * configuration the runtime was served with (the harness serves it; this file never changes it):
 * - "off": NALYNT_V2_PLAN_GENERATION_ENABLED absent / false — a V2 rider gets 503 v2_generation_disabled, nothing written;
 * - "on_unsigned": the switch on, the real bundle (production tables: nothing signed) — a DH plan is refused 422
 *   dh_repetition_unit_unknown, nothing written: no unit, no count, no partial plan;
 * - "on_test_signed": the switch on, the bundle rebuilt by tests/edge/http/buildTestSignedEdgeBundle.mjs (TEST
 *   sign-offs, never deployed) — the plan is generated with SECTION counts; a replay returns the same plan.
 * Opt-in: RUN_LOCAL_P0_EDGE=1 and NALYNT_TEST_EDGE_V2_MODE set.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { FunctionsHttpError, SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, setAthleteDiscipline } from "./testDb.js";
import { execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";

const MODE = process.env.NALYNT_TEST_EDGE_V2_MODE;
const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1" && MODE !== undefined;

describe.skipIf(!ENABLED)(`V2-DH-RELEASE-GATES-01 — generate-training-plan over HTTP, runtime "${MODE}"`, { timeout: 180_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function v2Rider() {
    const a = await createTestAthlete(admin, `release gates ${MODE}`);
    execLocalSql(`insert into public.training_plan_model_assignments (athlete_id, planning_model, note) values (${sqlLiteral(a.athleteId)}, 'v2', 'V2-DH-RELEASE-GATES-01 test');`);
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
    return { athleteId: a.athleteId, client: await getAthleteAuthClient(a.athleteId) };
  }
  type Answer = { status: number; body: { error?: { code?: string; detail?: Record<string, unknown> } } & Record<string, unknown> };
  async function generate(client: SupabaseClient, generationRequestId: string): Promise<Answer> {
    const { data, error } = await client.functions.invoke("generate-training-plan", { body: { generationRequestId, durationWeeks: 2 } });
    if (!error) return { status: 200, body: data as Answer["body"] };
    const response = (error as FunctionsHttpError).context as Response;
    return { status: response.status, body: (await response.json()) as Answer["body"] };
  }
  const writes = (athleteId: string) =>
    execLocalSql(
      `select concat_ws(',', (select count(*) from public.training_plan_versions where athlete_id = ${sqlLiteral(athleteId)}),
         (select count(*) from public.training_plan_planned_prescriptions p join public.training_plan_versions v on v.id = p.plan_version_id where v.athlete_id = ${sqlLiteral(athleteId)}));`
    ).trim();

  it.runIf(MODE === "off")("V2 OFF: a V2 rider's generation is refused 503 v2_generation_disabled; nothing is written", async () => {
    const r = await v2Rider();
    const out = await generate(r.client, randomUUID());
    expect([out.status, out.body.error?.code]).toEqual([503, "v2_generation_disabled"]);
    expect(writes(r.athleteId)).toBe("0,0");
  });

  it.runIf(MODE === "on_unsigned")("V2 ON, nothing signed (production tables): 422 dh_repetition_unit_unknown naming the drill; no plan, no prescription", async () => {
    const r = await v2Rider();
    const out = await generate(r.client, randomUUID());
    expect(out.status).toBe(422);
    expect(out.body.error).toMatchObject({ code: "dh_repetition_unit_unknown", detail: { drillId: "roots_rocks_unweighted_line" } });
    expect(writes(r.athleteId)).toBe("0,0");
  });

  it.runIf(MODE === "on_test_signed")("V2 ON, TEST sign-offs (local bundle): generated with SECTION counts; the same request replays the same plan", async () => {
    const r = await v2Rider();
    const request = randomUUID();
    const first = await generate(r.client, request);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const measures = execLocalSql(
      `select coalesce(string_agg(distinct coalesce(i.item -> 'measure' ->> 'unit', 'NONE'), ','), '') from public.training_plan_planned_prescriptions p
         join public.training_plan_versions v on v.id = p.plan_version_id
         cross join lateral jsonb_array_elements(p.structure -> 'blocks') b(block)
         cross join lateral jsonb_array_elements(b.block -> 'items') i(item)
        where v.athlete_id = ${sqlLiteral(r.athleteId)} and i.item ->> 'kind' = 'drill';`
    ).trim();
    expect(measures).toBe("SECTION");
    const versions = writes(r.athleteId).split(",")[0];
    expect(versions).toBe("1");
    const again = await generate(r.client, request);
    expect(again.status).toBe(200);
    expect(writes(r.athleteId).split(",")[0]).toBe("1");
  });
});
