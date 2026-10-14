/**
 * INT-01 (HPM 2026-10-13, GO correction débrief V1) — the legacy debrief (« Raconter ma séance », Edge
 * completed-session → persist_completed_session) under a health suspension, on the real local runtime with the
 * rider's JWT: a guided session stopped under a suspension never becomes a V1 realisation, before or after the
 * signal is closed; legitimate debriefs keep their rules. Migration 20261013180000.
 *
 * Opt-in: RUN_LOCAL_P0_EDGE=1 (Edge Functions served locally) and RUN_LOCAL_SUPABASE_INTEGRATION=1.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays, productToday } from "../../src/supabase/productCalendar.js";
import { buildRawContext } from "../../src/supabase/buildRawContext.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";

type Body = Record<string, unknown>;
type Item = { kind: string; prescriptionItemId: string; sets?: number; measure: { type: string; count?: number } };
type Structure = { blocks: { role: string; items: Item[] }[] };
type Rider = { athleteId: string; client: SupabaseClient; days: { date: string; kind: string }[] };

describe.skipIf(!EDGE)("INT-01 — V1 debrief under a health suspension (local Edge, rider JWT)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  const today = productToday();

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  async function invoke(client: SupabaseClient, fn: string, body: unknown, method?: "PUT" | "POST"): Promise<{ status: number; body: Body }> {
    const { data, error } = await client.functions.invoke(fn, { body: body as Body, ...(method ? { method } : {}) });
    if (!error) return { status: 200, body: data as Body };
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      return { status: res.status, body: (await res.json()) as Body };
    }
    throw error;
  }
  const code = (r: { body: Body }) => (r.body.error as { code?: string } | undefined)?.code;

  /** A rider onboarded ten days ago with an accepted V2 plan (P0-4 harness), and the plan's past days. */
  async function rider(): Promise<Rider> {
    const { athleteId } = await createTestAthlete(admin, `INT-01 debrief ${randomUUID().slice(0, 6)}`);
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
    const assigned = await admin.from("training_plan_model_assignments").insert({ athlete_id: athleteId, planning_model: "v2", note: "INT-01 debrief guard" });
    if (assigned.error) throw new Error(assigned.error.message);
    const generatedOn = addCalendarDays(today, -10);
    const plan = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: generatedOn });
    if (plan.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, plan.planVersionId, addCalendarDays(generatedOn, 1), addCalendarDays(generatedOn, 14));
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).lt("planned_date", today).order("planned_date");
    const days = ((data ?? []) as { planned_date: string; intervention: { kind: string } | null }[])
      .filter((r) => r.intervention && r.intervention.kind !== "REST")
      .map((r) => ({ date: r.planned_date, kind: r.intervention!.kind }));
    return { athleteId, client: await getAthleteAuthClient(athleteId), days };
  }

  async function dailyRun(r: Rider, day: string) {
    const run = await invoke(r.client, "daily-run", { date: day });
    expect(run.status, JSON.stringify(run.body).slice(0, 200)).toBe(200);
    return run.body as { decisionId: string; dailyPlan: { decision: string; triggered_rules: { layer: string; rule_id: string }[] }; finalPrescriptionStatus?: string; finalPrescription?: { id: string; structure: Structure } };
  }

  /** Check-in, daily-run (created), a guided execution started with `results` results. */
  async function startGuided(r: Rider, day: string, results: number): Promise<string> {
    await insertCheckin(admin, r.athleteId, day);
    const run = await dailyRun(r, day);
    expect(run.finalPrescriptionStatus).toBe("created");
    const fp = run.finalPrescription!;
    const executionId = randomUUID();
    const start = await invoke(r.client, "session-execution", { execution: { id: executionId, session_date: day, started_at: `${day}T07:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: `${day}T07:00:00Z` }] });
    expect(start.status).toBe(200);
    let recorded = 0;
    for (const block of fp.structure.blocks) {
      if (!["main", "complementary"].includes(block.role)) continue;
      for (const item of block.items) {
        const pass = item.measure.type === "pass";
        const bound = pass ? item.measure.count ?? 0 : item.sets ?? 0;
        if (item.kind !== "exercise" && !pass) continue;
        for (let n = 1; n <= bound && recorded < results; n += 1, recorded += 1) {
          const set = { id: randomUUID(), execution_id: executionId, prescription_item_id: item.prescriptionItemId, set_number: n, done: true, measure_type: item.measure.type, measure_value: pass ? null : item.measure.type === "duration" ? 30 : 8, ...(pass ? { success: true } : { load_kg: 20, rpe_actual: 7 }), occurred_at: `${day}T07:${String(10 + n).padStart(2, "0")}:00Z` };
          expect((await invoke(r.client, "session-execution", { sets: [set] })).status).toBe(200);
        }
      }
    }
    return executionId;
  }

  const event = (r: Rider, executionId: string, type: string, day: string) =>
    invoke(r.client, "session-execution", { events: [{ id: randomUUID(), execution_id: executionId, event_type: type, occurred_at: `${day}T07:50:00Z` }] });

  /** Pain 8/10 (not new, no gravity criterion): P0-SAFE A6, a Safety REST and an injury_suspect signal. */
  async function declarePain(r: Rider, day: string, intensity = 8) {
    const { error } = await admin
      .from("daily_checkins")
      .update({ pain: true, pain_intensity: intensity, pain_new: false, pain_location_code: "knee_L", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false })
      .eq("athlete_id", r.athleteId)
      .eq("checkin_date", day);
    if (error) throw new Error(error.message);
  }

  function debrief(day: string, status: "done" | "partial" | "replaced" | "skipped", decisionId: string | null = null): Body {
    const base = { session_date: day, decision_id: decisionId, new_pain: false, new_pain_note: null, post_leg_fatigue: null, post_grip_fatigue: null, main_content: null };
    if (status === "skipped") return { ...base, session_type: "DH_TECHNICAL", completion_status: "skipped", actual_duration_min: null, rpe: null, intervention: null };
    if (status === "replaced") return { ...base, session_type: "AEROBIC_BASE", completion_status: "replaced", actual_duration_min: 45, rpe: 5, intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" } };
    return { ...base, session_type: "DH_TECHNICAL", completion_status: status, actual_duration_min: status === "done" ? 90 : 40, rpe: 7, intervention: { kind: "DH_TECHNICAL", load_profile: "MODERATE" } };
  }
  const put = (r: Rider, body: Body) => invoke(r.client, "completed-session", body, "PUT");

  async function completedRows(r: Rider, day: string) {
    const { data } = await admin.from("completed_sessions").select("completion_status").eq("athlete_id", r.athleteId).eq("session_date", day);
    return (data ?? []).map((row) => row.completion_status as string);
  }
  async function executionState(executionId: string) {
    const [{ data: events }, { count }] = await Promise.all([
      admin.from("execution_events").select("event_type, event_seq").eq("execution_id", executionId).order("event_seq"),
      admin.from("exercise_set_results").select("id", { count: "exact", head: true }).eq("execution_id", executionId),
    ]);
    return { events: (events ?? []).map((e) => e.event_type), results: count };
  }

  it("1–4, 9 — started, pain 8/10 (A6), stopped: « Terminée », « Partielle », « Remplacée » and « Non réalisée » refused; nothing written; the guided results stay", async () => {
    const r = await rider();
    const day = r.days.find((d) => d.kind === "DH_TECHNICAL")!.date;
    const executionId = await startGuided(r, day, 2);
    await declarePain(r, day);
    const rest = await dailyRun(r, day);
    expect([rest.dailyPlan.decision, rest.dailyPlan.triggered_rules.some((t) => t.layer === "A" && t.rule_id === "A6")]).toEqual(["REST", true]);
    expect((await event(r, executionId, "abandoned", day)).status).toBe(200);

    for (const status of ["done", "partial", "replaced"] as const) {
      const refused = await put(r, debrief(day, status));
      expect([refused.status, code(refused)], status).toEqual([409, "health_suspended"]);
    }
    // Linked to the morning decision (the guided session's own KEEP): still refused.
    const { data: morning } = await admin.from("decisions").select("id").eq("athlete_id", r.athleteId).eq("decision_date", day).order("created_at").limit(1);
    expect(morning![0]!.id).not.toBe(rest.decisionId);
    const linked = await put(r, debrief(day, "done", morning![0]!.id as string));
    expect([linked.status, code(linked)]).toEqual([409, "health_suspended"]);
    const skipped = await put(r, debrief(day, "skipped"));
    expect([skipped.status, code(skipped)]).toEqual([409, "guided_results_exist"]);
    // Replay of a refused request: the same refusal.
    const replay = await put(r, debrief(day, "done"));
    expect([replay.status, code(replay)]).toEqual([409, "health_suspended"]);

    expect(await completedRows(r, day)).toEqual([]);
    expect(await executionState(executionId)).toEqual({ events: ["started", "abandoned"], results: 2 });
  });

  it("6, 9 — the signal closed after the stop (and a new ordinary decision): the stopped attempt still never becomes a V1 realisation", async () => {
    const r = await rider();
    const day = r.days.find((d) => d.kind === "DH_TECHNICAL")!.date;
    const executionId = await startGuided(r, day, 2);
    await declarePain(r, day);
    await dailyRun(r, day);
    expect((await event(r, executionId, "abandoned", day)).status).toBe(200);

    const { data: flags } = await admin.from("health_flags").select("id").eq("athlete_id", r.athleteId).eq("status", "active");
    expect(flags).toHaveLength(1);
    const flagId = flags![0]!.id as string;
    const inspected = await invoke(r.client, "health-flag-resolution", { flagId, inspect: true }, "POST");
    expect(inspected.status).toBe(200);
    const zones = (inspected.body.requirements as { zones: string[] }).zones;
    const closed = await invoke(r.client, "health-flag-resolution", { flagId, confirmedZones: zones }, "POST");
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const cleared = await admin.from("daily_checkins").update({ pain: false, pain_intensity: null, pain_new: false, pain_location_code: null, pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false }).eq("athlete_id", r.athleteId).eq("checkin_date", day);
    if (cleared.error) throw new Error(cleared.error.message);
    const after = await dailyRun(r, day);
    expect(after.dailyPlan.decision).not.toBe("REST");

    for (const status of ["done", "partial", "replaced"] as const) {
      const refused = await put(r, debrief(day, status));
      expect([refused.status, code(refused)], status).toEqual([409, "health_suspended"]);
    }
    const skipped = await put(r, debrief(day, "skipped"));
    expect([skipped.status, code(skipped)]).toEqual([409, "guided_results_exist"]);
    expect(await completedRows(r, day)).toEqual([]);
    expect(await executionState(executionId)).toEqual({ events: ["started", "abandoned"], results: 2 });
  });

  it("5, 9 — a signal opened on an earlier day, before the day's daily-run: « Terminée » refused; « Non réalisée » (no guided result) allowed", async () => {
    const r = await rider();
    const [first, later] = r.days.filter((d) => d.kind === "DH_TECHNICAL").map((d) => d.date);
    await insertCheckin(admin, r.athleteId, first!);
    await declarePain(r, first!);
    const rest = await dailyRun(r, first!);
    expect(rest.dailyPlan.decision).toBe("REST");

    const refused = await put(r, debrief(later!, "done"));
    expect([refused.status, code(refused)]).toEqual([409, "health_suspended"]);
    const skipped = await put(r, debrief(later!, "skipped"));
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    expect(await completedRows(r, later!)).toEqual(["skipped"]);
  });

  it("7, 9 — ordinary days (no health signal): no V1 debrief over a guided attempt with results, nor over a completed one; normal debriefs and an attempt stopped before any result keep their rules", async () => {
    const r = await rider();
    // Sets / passes are recordable (and a completion accepted) on DH and Force days; endurance needs an activity.
    const recordable = r.days.filter((d) => d.kind.startsWith("DH_") || d.kind.startsWith("STRENGTH_")).map((d) => d.date);
    const [stopped, completedDay, open] = recordable;
    const [plain, stoppedEmpty] = r.days.map((d) => d.date).filter((d) => ![stopped, completedDay, open].includes(d));
    await insertCheckin(admin, r.athleteId, plain!);
    await dailyRun(r, plain!);
    const ok = await put(r, debrief(plain!, "done"));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await completedRows(r, plain!)).toEqual(["done"]);

    // A guided attempt with results, abandoned for an ordinary reason: it is the day's record (HPM contract).
    const e1 = await startGuided(r, stopped!, 2);
    expect((await event(r, e1, "abandoned", stopped!)).status).toBe(200);
    for (const status of ["done", "partial", "replaced", "skipped"] as const) {
      const refused = await put(r, debrief(stopped!, status));
      expect([refused.status, code(refused)], status).toEqual([409, "guided_results_exist"]);
    }
    expect(await completedRows(r, stopped!)).toEqual([]);
    expect(await executionState(e1)).toEqual({ events: ["started", "abandoned"], results: 2 });

    // An attempt stopped before any result: the ordinary debrief stays open (UX-11R.9).
    const e2 = await startGuided(r, stoppedEmpty!, 0);
    expect((await event(r, e2, "abandoned", stoppedEmpty!)).status).toBe(200);
    expect((await put(r, debrief(stoppedEmpty!, "done"))).status).toBe(200);

    // A completed guided session: still NX101 (never a second main session).
    const e3 = await startGuided(r, completedDay!, 1);
    expect((await event(r, e3, "completed", completedDay!)).status).toBe(200);
    const afterCompletion = await put(r, debrief(completedDay!, "done"));
    expect([afterCompletion.status, code(afterCompletion)]).toEqual([409, "completed_session_v2_exists"]);

    await startGuided(r, open!, 1);
    const refused = await put(r, debrief(open!, "done"));
    expect([refused.status, code(refused)]).toEqual([409, "completed_session_v2_exists"]);

    // Nothing reaches M1's recent load for that day (the abandoned attempt itself never counts).
    const nextDay = addCalendarDays(stopped!, 1);
    const { count: nextCheckins } = await admin.from("daily_checkins").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId).eq("checkin_date", nextDay);
    if (!nextCheckins) await insertCheckin(admin, r.athleteId, nextDay);
    const raw = await buildRawContext(admin, r.athleteId, nextDay);
    expect(raw.rawContext.recent_sessions.filter((x) => x.date === stopped)).toEqual([]);
  });

  it("8 — an ordinary rest day (no Safety rule) never blocks a debrief", async () => {
    const r = await rider();
    const day = r.days[0]!.date;
    // The rider's own planning write, as /plan does (RLS; the server role has no direct write on planned_sessions).
    const { error } = await r.client
      .from("planned_sessions")
      .update({ source: "manual", session_type: "REST", intervention: { kind: "REST" }, source_plan_version_id: null, source_generated_session_id: null })
      .eq("athlete_id", r.athleteId)
      .eq("planned_date", day);
    if (error) throw new Error(error.message);
    await insertCheckin(admin, r.athleteId, day);
    // A planned rest day: M1 keeps a REST session (the REST decision belongs to the Safety layer only).
    const rest = await dailyRun(r, day);
    expect([rest.dailyPlan.decision, (rest.dailyPlan as unknown as { final_session: { kind: string } }).final_session.kind]).toEqual(["KEEP", "REST"]);
    expect(rest.dailyPlan.triggered_rules.some((t) => t.layer === "A")).toBe(false);
    const ok = await put(r, debrief(day, "replaced"));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("10 — isolation and direct access: another rider's decision is refused; no API role writes or calls the guard directly", async () => {
    const a = await rider();
    const b = await rider();
    const day = a.days[0]!.date;
    await insertCheckin(admin, a.athleteId, day);
    const decision = await dailyRun(a, day);
    const crossed = await put(b, debrief(day, "done", decision.decisionId));
    expect([crossed.status, code(crossed)]).toEqual([422, "decision_link_invalid"]);

    const rpc = await b.client.rpc("persist_completed_session", { p_athlete_id: b.athleteId, p_row: debrief(day, "done") });
    expect(rpc.error).not.toBeNull();
    const guard = await b.client.rpc("completed_session_health_block", { p_athlete_id: a.athleteId, p_date: day, p_completion_status: "done", p_family: "other" });
    expect(guard.error).not.toBeNull();
    const insert = await b.client.from("completed_sessions").insert({ athlete_id: b.athleteId, session_date: day, session_type: "DH_TECHNICAL", completion_status: "done", new_pain: false });
    expect(insert.error).not.toBeNull();
    const anon = createClient(resolveTestSupabaseUrl(), process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false } });
    expect((await anon.rpc("persist_completed_session", { p_athlete_id: a.athleteId, p_row: debrief(day, "done") })).error).not.toBeNull();
    expect(await completedRows(b, day)).toEqual([]);
  });

  it("10 — concurrency: a debrief « Terminée » and a guided start of the same day are serialized — exactly one wins", async () => {
    const r = await rider();
    for (const day of r.days.slice(0, 3).map((d) => d.date)) {
      await insertCheckin(admin, r.athleteId, day);
      const run = await dailyRun(r, day);
      const executionId = randomUUID();
      const [debriefed, started] = await Promise.all([
        put(r, debrief(day, "done")),
        invoke(r.client, "session-execution", { execution: { id: executionId, session_date: day, started_at: `${day}T07:00:00Z`, final_prescription_id: run.finalPrescription!.id }, events: [{ id: randomUUID(), execution_id: executionId, event_type: "started", occurred_at: `${day}T07:00:00Z` }] }),
      ]);
      const winners = [debriefed.status, started.status].filter((s) => s === 200).length;
      expect(winners, `${day}: debrief ${debriefed.status} ${code(debriefed)}, start ${started.status} ${code(started)}`).toBe(1);
      // The loser's refusal follows from the winner: a V1 « done » blocks the start (F-6B), an open guided session
      // blocks the debrief (NX101).
      if (debriefed.status === 200) expect([started.status, code(started)]).toEqual([409, "session_already_completed"]);
      else expect([debriefed.status, code(debriefed)]).toEqual([409, "completed_session_v2_exists"]);
    }
  });
});
