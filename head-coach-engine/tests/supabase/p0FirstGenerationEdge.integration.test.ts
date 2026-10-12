/**
 * P0 FIRST GENERATION — the public generate-training-plan Edge Function on the LOCAL runtime, as a
 * brand-new rider calls it right after onboarding (real JWT, real HTTP).
 *
 * Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served with NALYNT_V2_PLAN_GENERATION_ENABLED=true (and
 * without NALYNT_ENTITLEMENT_ENFORCED: the free beta).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { MATRIX } from "./p0FirstGenerationMatrix.integration.test.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";

describe.skipIf(!ENABLED)("P0 first generation — generate-training-plan over HTTP (local runtime)", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string) {
    const p = MATRIX.find((m) => m.name.startsWith(name))!;
    const a = await createTestAthlete(admin, `P0 edge ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, a.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, a.athleteId, p.profile);
    for (const w of p.windows) await insertAvailabilityWindow(admin, a.athleteId, w);
    return { athleteId: a.athleteId, client: await getAthleteAuthClient(a.athleteId), weeks: p.weeks };
  }
  async function generate(client: SupabaseClient, body: Record<string, unknown>) {
    const { data, error } = await client.functions.invoke("generate-training-plan", { body });
    if (!error) return { status: 200, body: data as Record<string, unknown> };
    const response = (error as FunctionsHttpError).context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it("the 9 October review rider: generated at the FIRST attempt with the three real terrains; a retry of the same request replays the same plan", async () => {
    const r = await rider("A");
    const generationRequestId = randomUUID();
    const first = await generate(r.client, { generationRequestId, durationWeeks: r.weeks });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await generate(r.client, { generationRequestId, durationWeeks: r.weeks });
    expect([again.status, again.body.planVersionId, again.body.idempotentReplay]).toEqual([200, first.body.planVersionId, true]);
    const { count } = await admin.from("training_plan_versions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);
    expect(count).toBe(1);
  });

  it("a truly impossible priority: 422 with the priority and EVERY compatible terrain, nothing persisted", async () => {
    const r = await rider("E");
    const out = await generate(r.client, { generationRequestId: randomUUID(), durationWeeks: r.weeks });
    expect(out.status).toBe(422);
    expect((out.body as { error: unknown }).error).toMatchObject({ code: "unavailable_dh_drill_terrain", detail: { skill: "jumps", requiredTerrain: "bike_park_jump_line", compatibleTerrains: ["bike_park_jump_line"] } });
    const { count } = await admin.from("training_plan_versions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);
    expect(count).toBe(0);
  });
});
