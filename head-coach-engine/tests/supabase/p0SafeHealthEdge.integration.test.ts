/**
 * P0-SAFE — health-flag-resolution and daily-run over HTTP on the LOCAL runtime (real JWT, real Edge).
 * Requested (RUN_LOCAL_SUPABASE_INTEGRATION=1) but the runtime not serving → the file fails with the fix.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true });

async function assertServing(fn: string): Promise<void> {
  const url = `${resolveTestSupabaseUrl()}/functions/v1/${fn}`;
  let last: number | string = "no answer";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      last = res.status;
      if (![502, 503, 504].includes(res.status)) return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local Edge runtime is not serving ${fn} (last answer: ${last}). Start it: \`npx supabase functions serve\`.`);
}

async function invoke(client: SupabaseClient, fn: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> & { error?: { code?: string } } }> {
  const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (!error) return { status: 200, body: data as Record<string, unknown> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  throw error;
}

describe.skipIf(!ENABLED)("P0-SAFE — Edge: closing a health signal, and the daily decision around it (local runtime)", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(async () => {
    await Promise.all(["health-flag-resolution", "daily-run"].map(assertServing));
    admin = createTestClient();
  });
  const flagsOf = async (athleteId: string) => {
    const { data } = await admin.from("health_flags").select("id, flag_type, status, resolution_note").eq("athlete_id", athleteId);
    return (data ?? []) as { id: string; flag_type: string; status: string; resolution_note: string | null }[];
  };

  it("fever day → REST + illness signal; next day normal → REST (A7) over HTTP; closed by the rider → a training decision again", async () => {
    const { athleteId } = await createTestAthlete(admin, "P0-SAFE edge illness");
    const rider = await getAthleteAuthClient(athleteId);
    await insertCheckin(admin, athleteId, "2026-11-02", { fever_or_illness: true });
    const d0 = await invoke(rider, "daily-run", { date: "2026-11-02" });
    expect([d0.status, (d0.body.dailyPlan as { decision: string }).decision]).toEqual([200, "REST"]);

    await insertCheckin(admin, athleteId, "2026-11-03");
    const d1 = await invoke(rider, "daily-run", { date: "2026-11-03" });
    const plan1 = d1.body.dailyPlan as { decision: string; triggered_rules: { rule_id: string }[]; reasoning: string };
    expect([d1.status, plan1.decision, plan1.triggered_rules[0]!.rule_id]).toEqual([200, "REST", "A7"]);
    expect(plan1.reasoning).toMatch(/maladie \/ fièvre du 02\.11\) est toujours ouvert\. Par prudence, NALYNT suspend ses propositions/);

    const [flag] = await flagsOf(athleteId);
    const closed = await invoke(rider, "health-flag-resolution", { flagId: flag!.id });
    expect([closed.status, closed.body.status]).toEqual([200, "resolved"]);
    expect((await flagsOf(athleteId))[0]).toMatchObject({ status: "resolved", resolution_note: expect.stringMatching(/Clôturé par le rider/) });

    const again = await invoke(rider, "health-flag-resolution", { flagId: flag!.id });
    expect([again.status, again.body.error?.code]).toEqual([409, "health_flag_already_resolved"]);

    const d1b = await invoke(rider, "daily-run", { date: "2026-11-03" });
    const plan1b = d1b.body.dailyPlan as { triggered_rules: { layer: string }[] };
    expect(plan1b.triggered_rules.some((t) => t.layer === "A")).toBe(false);
  });

  it("grave signal over HTTP: inspect tells what is required; a declaration alone → 409 professional_clearance_required (with the requirements); an attested clearance → 200", async () => {
    const { athleteId } = await createTestAthlete(admin, "P0-SAFE edge grave");
    const rider = await getAthleteAuthClient(athleteId);
    await insertCheckin(admin, athleteId, "2026-11-06", { pain: true, pain_intensity: 7, pain_new: false, pain_location_code: "knee_R", pain_traumatic: true, pain_function_loss: false, pain_getting_worse: false });
    expect(((await invoke(rider, "daily-run", { date: "2026-11-06" })).body.dailyPlan as { triggered_rules: { rule_id: string }[] }).triggered_rules[0]!.rule_id).toBe("A4");
    const [flag] = await flagsOf(athleteId);
    const requirements = { zones: ["knee_R"], requiresProfessionalClearance: true };

    const inspected = await invoke(rider, "health-flag-resolution", { flagId: flag!.id, inspect: true });
    expect([inspected.status, inspected.body.requirements]).toEqual([200, requirements]);
    expect((await flagsOf(athleteId))[0]!.status).toBe("active"); // inspect never writes

    const declared = await invoke(rider, "health-flag-resolution", { flagId: flag!.id, professionalConsulted: true });
    expect([declared.status, declared.body.error?.code, (declared.body.error as { detail?: unknown }).detail]).toEqual([409, "professional_clearance_required", requirements]);
    expect((await invoke(rider, "health-flag-resolution", { flagId: flag!.id, confirmedZones: "knee_R" })).status).toBe(400);
    expect((await invoke(rider, "health-flag-resolution", { flagId: flag!.id, professionalClearance: "yes" })).status).toBe(400);

    const cleared = await invoke(rider, "health-flag-resolution", { flagId: flag!.id, professionalClearance: true });
    expect([cleared.status, cleared.body.status]).toEqual([200, "resolved"]);
    expect((await flagsOf(athleteId))[0]!.resolution_note).toMatch(/autorisée par un professionnel de santé \(attestation du rider\)\. Aucune vérification médicale par NALYNT\./);
  });

  it("guards: no JWT → 401; malformed or unknown keys → 400; another rider's signal → 404 (unchanged); a concussion → 409 medical_validation_required", async () => {
    const owner = await createTestAthlete(admin, "P0-SAFE edge owner");
    const stranger = await createTestAthlete(admin, "P0-SAFE edge stranger");
    await insertCheckin(admin, owner.athleteId, "2026-11-05", { suspected_concussion: true });
    const ownerClient = await getAthleteAuthClient(owner.athleteId);
    await invoke(ownerClient, "daily-run", { date: "2026-11-05" });
    const [concussion] = await flagsOf(owner.athleteId);

    const anonymous = await fetch(`${resolveTestSupabaseUrl()}/functions/v1/health-flag-resolution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flagId: concussion!.id }) });
    expect(anonymous.status).toBe(401);

    expect((await invoke(ownerClient, "health-flag-resolution", { flagId: "nope" })).status).toBe(400);
    expect((await invoke(ownerClient, "health-flag-resolution", { flagId: concussion!.id, athleteId: stranger.athleteId })).status).toBe(400);
    expect((await invoke(ownerClient, "health-flag-resolution", { flagId: concussion!.id, professionalConsulted: "yes" })).status).toBe(400);

    const strangerClient = await getAthleteAuthClient(stranger.athleteId);
    const foreign = await invoke(strangerClient, "health-flag-resolution", { flagId: concussion!.id });
    expect([foreign.status, foreign.body.error?.code]).toEqual([404, "health_flag_not_found"]);

    const medical = await invoke(ownerClient, "health-flag-resolution", { flagId: concussion!.id, professionalClearance: true });
    expect([medical.status, medical.body.error?.code]).toEqual([409, "medical_validation_required"]);
    expect((await flagsOf(owner.athleteId))[0]!.status).toBe("active");
  });
});
