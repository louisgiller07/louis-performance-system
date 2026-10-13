/**
 * P0-3 (HPM 2026-10-13) — server audit: a guided session started, then a health signal suspends the coaching
 * (check-in edited with a severe pain → daily-run → REST, A6). Through the local Edge runtime with the rider's JWT:
 * what session-execution still accepts on the OPEN execution. Measured, nothing changed (diagnostic).
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";

type Item = { kind: string; prescriptionItemId: string; measure: { type: string } };
type Structure = { blocks: { role: string; items: Item[] }[] };
type Body = Record<string, unknown>;

describe.skipIf(!EDGE)("P0-3 audit — open execution after a health suspension (local Edge, rider JWT)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  const report: Record<string, unknown> = {};

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  afterAll(() => {
    if (process.env.P0_3_REPORT) writeFileSync(process.env.P0_3_REPORT, JSON.stringify(report, null, 2));
  });

  async function invoke(client: SupabaseClient, fn: string, body: unknown): Promise<{ status: number; body: Body }> {
    const { data, error } = await client.functions.invoke(fn, { body });
    if (!error) return { status: 200, body: data as Body };
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      return { status: res.status, body: (await res.json()) as Body };
    }
    throw error;
  }

  it("started session, then REST A6 (coaching suspended): what the server still accepts on the open execution", async () => {
    const { athleteId } = await createTestAthlete(admin, `P0-3 health audit ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (p.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, "2026-10-05", "2026-10-18");
    const { data: rows } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).order("planned_date");
    const day = (rows as { planned_date: string; intervention: { kind: string } | null }[]).find((r) => r.intervention?.kind === "DH_TECHNICAL")!.planned_date;
    const rider = await getAthleteAuthClient(athleteId);

    await insertCheckin(admin, athleteId, day);
    const first = await invoke(rider, "daily-run", { date: day });
    expect([first.status, first.body.finalPrescriptionStatus]).toEqual([200, "created"]);
    const fp = first.body.finalPrescription as { id: string; structure: Structure };
    const items = fp.structure.blocks.find((b) => b.role === "main")!.items;
    const id = randomUUID();
    const ev = (event_type: string, at: string) => ({ events: [{ id: randomUUID(), execution_id: id, event_type, occurred_at: `${day}T${at}:00Z` }] });
    const set = (item: Item, n: number, at: string) => ({ id: randomUUID(), execution_id: id, prescription_item_id: item.prescriptionItemId, set_number: n, done: true, measure_type: item.measure.type, measure_value: item.measure.type === "pass" ? null : 8, occurred_at: `${day}T${at}:00Z` });
    expect((await invoke(rider, "session-execution", { execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fp.id }, ...ev("started", "17:00") })).status).toBe(200);
    expect((await invoke(rider, "session-execution", { sets: [set(items[0]!, 1, "17:10")] })).status).toBe(200);

    // The rider edits the check-in: severe pain (A6) → the day's decision becomes REST, coaching suspended.
    const { error } = await admin
      .from("daily_checkins")
      .update({ pain: true, pain_intensity: 8, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false })
      .eq("athlete_id", athleteId)
      .eq("checkin_date", day);
    if (error) throw new Error(error.message);
    const suspended = await invoke(rider, "daily-run", { date: day });
    const plan = suspended.body.dailyPlan as { decision: string; triggered_rules: { rule_id: string; layer: string }[] };
    report.suspension = { status: suspended.status, decision: plan.decision, rules: plan.triggered_rules.filter((r) => r.layer === "A").map((r) => r.rule_id), finalPrescriptionStatus: suspended.body.finalPrescriptionStatus };
    expect([plan.decision, plan.triggered_rules.some((r) => r.rule_id === "A6")]).toEqual(["REST", true]);

    // What the server accepts now on the open execution (each attempt independent, in lifecycle order).
    const attempts: Record<string, unknown> = {};
    const tryIt = async (label: string, payload: unknown) => {
      const r = await invoke(rider, "session-execution", payload);
      attempts[label] = `${r.status} ${r.body.status ?? ""}${r.body.code ? ` ${r.body.code}` : ""}${r.body.error ? ` ${JSON.stringify(r.body.error)}` : ""}`.trim();
    };
    await tryIt("new set (effort)", { sets: [set(items[0]!, 2, "18:10")] });
    await tryIt("pause", ev("paused", "18:11"));
    await tryIt("resume", ev("resumed", "18:12"));
    await tryIt("another set after resume", { sets: [set(items[1] ?? items[0]!, items[1] ? 1 : 3, "18:13")] });
    await tryIt("complete", ev("completed", "18:20"));
    report.attemptsAfterSuspension = attempts;
    const { data: results } = await admin.from("exercise_set_results").select("id").eq("execution_id", id);
    report.setResultsKept = (results ?? []).length;
    // OBSERVED (reported to the HPM, not fixed here): nothing on the open execution consults the suspension.
    expect(attempts).toEqual({ "new set (effort)": "200", pause: "200", resume: "200", "another set after resume": "200", complete: "200" });
    expect(report.setResultsKept).toBe(3);
  });
});
