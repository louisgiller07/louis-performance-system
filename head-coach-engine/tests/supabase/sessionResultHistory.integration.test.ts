/**
 * PARTIAL-01-L2 (HPM 2026-10-21) — the real session history on the LOCAL Supabase, through the real write paths: a V2
 * plan generated and accepted, real daily runs, guided sessions recorded by record_session_execution, V1 debriefs by
 * persist_completed_session. Then the read-only adapter, under the generation's service-role client and under each
 * rider's own client (RLS).
 *
 * Plan A (generated the eve of 2026-10-05, all-day windows) — week 2: DH 10-12 / 10-13 (90), STRENGTH_LOWER 10-14 (60),
 * STRENGTH_UPPER 10-15 (60), AEROBIC_BASE 10-16 (45).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { SessionResultHistoryReadError, readSessionResultHistoryFacts } from "../../src/supabase/repositories/sessionResultHistoryRepo.js";
import { sessionResultHistory, type SessionResultHistory, type V1DebriefEntry, type V2ExecutionEntry } from "../../src/supabase/mapping/sessionResultHistory.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const FROM = "2026-10-10";
const TO = "2026-10-17";

type Item = { kind: string; prescriptionItemId: string; sets?: number; measure: { type: string; min?: number; max?: number; count?: number } };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[]; activitySelection?: { activityIds: string[] } };

describe.skipIf(!ENABLED)("PARTIAL-01-L2 — real session history, real paths (local Supabase)", { timeout: 600_000 }, () => {
  let admin: SupabaseClient;
  let riderA: string;
  let riderB: string;
  const decided: Record<string, string> = {};

  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution: ${error.message}`);
    if ((data as { status: string }).status !== "ok") throw new Error(`record_session_execution rejected: ${JSON.stringify(data)}`);
  }
  async function finalOf(decisionId: string): Promise<{ id: string; structure: Structure }> {
    const { data, error } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", decisionId).single();
    if (error) throw new Error(`no final prescription for ${decisionId}: ${error.message}`);
    return data as { id: string; structure: Structure };
  }
  /** Starts a guided session of the day's decision; returns the execution id and the frozen prescription. */
  async function start(athleteId: string, date: string, at: string) {
    const fp = await finalOf(decided[date]!);
    const exec = randomUUID();
    await record(athleteId, { execution: { id: exec, session_date: date, started_at: `${date}T${at}:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${date}T${at}:00Z` }] });
    return { exec, structure: fp.structure };
  }
  const workItems = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
  const setRow = (exec: string, date: string, item: Item, setNumber: number, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: exec,
    prescription_item_id: item.prescriptionItemId,
    set_number: setNumber,
    done: true,
    measure_type: item.measure.type,
    measure_value: item.measure.type === "pass" ? null : item.measure.type === "duration" ? 30 : (item.measure.max ?? item.measure.min ?? 8),
    occurred_at: `${date}T17:${String(10 + setNumber).padStart(2, "0")}:00Z`,
    ...extra,
  });
  const terminal = (exec: string, date: string, type: "completed" | "abandoned", at = "18:00") => ({ id: randomUUID(), execution_id: exec, event_type: type, occurred_at: `${date}T${at}:00Z` });
  /** A V1 debrief through persist_completed_session (the « Raconter ma séance » path). */
  async function debrief(athleteId: string, row: Record<string, unknown>) {
    const base = { decision_id: null, main_content: null, free_notes: null, new_pain: false, new_pain_note: null, change_reason: null };
    const { error } = await admin.rpc("persist_completed_session", { p_athlete_id: athleteId, p_row: { ...base, ...row } });
    if (error) throw new Error(`persist_completed_session ${String(row.session_date)}: ${error.message}`);
  }
  const read = async (client: SupabaseClient, athleteId: string, from = FROM, to = TO): Promise<SessionResultHistory> => sessionResultHistory(await readSessionResultHistoryFacts(client, athleteId, from, to), from, to);

  /** Every row of the six read tables for the rider (proof the reads change nothing). */
  async function snapshot(athleteId: string) {
    const out: Record<string, unknown> = {};
    for (const [table, order] of [
      ["completed_sessions", "session_date"],
      ["session_executions", "id"],
      ["execution_events", "event_seq"],
      ["exercise_set_results", "id"],
      ["session_activity_results", "id"],
      ["decisions", "id"],
      ["decision_final_prescriptions", "id"],
    ] as const) {
      const { data, error } = await admin.from(table).select("*").eq("athlete_id", athleteId).order(order);
      if (error) throw new Error(`${table}: ${error.message}`);
      out[table] = data;
    }
    return JSON.stringify(out);
  }

  beforeAll(async () => {
    admin = createTestClient();
    // Rider A: a V2 plan, real decisions, guided sessions and V1 debriefs.
    riderA = (await createTestAthlete(admin, `PARTIAL-01-L2 A ${randomUUID().slice(0, 6)}`)).athleteId;
    await setAthleteDiscipline(admin, riderA, "Downhill");
    await upsertPerformanceProfileFor(admin, riderA, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, riderA, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const plan = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: riderA, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (plan.status !== "persisted") throw new Error(`plan A: ${plan.status}`);
    await acceptTrainingPlanVersion(admin, riderA, plan.planVersionId, "2026-10-05", "2026-10-18");
    for (const date of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      await insertCheckin(admin, riderA, date, {});
      decided[date] = (await runDailyFor(admin, riderA, date)).persistence.decision_id;
    }

    // 10-12 DH, every pass, success as evaluated by the rider (the third pass not evaluated).
    {
      const d = "2026-10-12";
      const { exec, structure } = await start(riderA, d, "17:00");
      const drill = workItems(structure)[0]!;
      const passes = Array.from({ length: drill.measure.count! }, (_, i) => setRow(exec, d, drill, i + 1, i === 2 ? {} : { success: i % 2 === 0 }));
      await record(riderA, { sets: passes, events: [terminal(exec, d, "completed")] });
    }
    // 10-13 DH, one pass only, « Terminer quand même ».
    {
      const d = "2026-10-13";
      const { exec, structure } = await start(riderA, d, "17:00");
      await record(riderA, { sets: [setRow(exec, d, workItems(structure)[0]!, 1, { success: true })], events: [terminal(exec, d, "completed")] });
    }
    // 10-14 Force: a first attempt stopped after two sets (with load and RPE), then a new attempt done in full, its
    // first set corrected before completion.
    {
      const d = "2026-10-14";
      const first = await start(riderA, d, "09:00");
      const items = workItems(first.structure).filter((i) => i.kind === "exercise");
      await record(riderA, { sets: [setRow(first.exec, d, items[0]!, 1, { load_kg: 20, rpe_actual: 7 }), setRow(first.exec, d, items[0]!, 2, { load_kg: 20 })], events: [terminal(first.exec, d, "abandoned", "09:20")] });
      const second = await start(riderA, d, "17:00");
      const all = items.flatMap((i) => Array.from({ length: i.sets! }, (_, k) => setRow(second.exec, d, i, k + 1, k === 0 ? { load_kg: 22.5, rpe_actual: 8 } : {})));
      await record(riderA, { sets: all });
      const correction = { ...setRow(second.exec, d, items[0]!, 1, { load_kg: 25, rpe_actual: 8.5 }), supersedes_id: all[0]!.id };
      await record(riderA, { sets: [correction], events: [terminal(second.exec, d, "completed")] });
    }
    // 10-15 Force upper: started, nothing recorded, never finished.
    await start(riderA, "2026-10-15", "17:00");
    // 10-16 endurance: 52 min 30 s, 21.4 km, RPE 6.
    {
      const d = "2026-10-16";
      const { exec, structure } = await start(riderA, d, "17:00");
      await record(riderA, {
        activities: [{ id: randomUUID(), execution_id: exec, activity_id: structure.activitySelection!.activityIds[0], duration_seconds: 3150, distance_m: 21400, rpe_actual: 6, occurred_at: `${d}T17:55:00Z` }],
        events: [terminal(exec, d, "completed")],
      });
    }
    // V1 debriefs: a declared session on 10-10, a « Non réalisée » on 10-17.
    await debrief(riderA, { session_date: "2026-10-10", session_type: "AEROBIC_BASE", completion_status: "done", actual_duration_min: 50, rpe: 6, intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }, post_leg_fatigue: 3, post_grip_fatigue: null });
    await debrief(riderA, { session_date: "2026-10-17", session_type: "DH_TECHNICAL", completion_status: "skipped", actual_duration_min: null, rpe: null, intervention: null, post_leg_fatigue: null, post_grip_fatigue: null, change_reason: "time_life" });

    // Rider B: one declared session the same day as A's first DH.
    riderB = (await createTestAthlete(admin, `PARTIAL-01-L2 B ${randomUUID().slice(0, 6)}`)).athleteId;
    await debrief(riderB, { session_date: "2026-10-12", session_type: "AEROBIC_BASE", completion_status: "done", actual_duration_min: 30, rpe: 4, intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, post_leg_fatigue: 1, post_grip_fatigue: 1 });
  });

  it("the history as the rider left it: one entry per record, real outcomes, partial never completed, nothing for a day without a record", async () => {
    const h = await read(admin, riderA);
    expect(h.entries.map((e) => [e.date, e.source, e.outcome, e.outcomeBasis])).toEqual([
      ["2026-10-10", "v1_debrief", "completed", "declared_by_rider"],
      ["2026-10-12", "v2_guided_execution", "completed", "results_vs_frozen_prescription"],
      ["2026-10-13", "v2_guided_execution", "partial", "results_vs_frozen_prescription"],
      ["2026-10-14", "v2_guided_execution", "abandoned", "lifecycle_event"],
      ["2026-10-14", "v2_guided_execution", "completed", "results_vs_frozen_prescription"],
      ["2026-10-15", "v2_guided_execution", "open", "lifecycle_event"],
      ["2026-10-16", "v2_guided_execution", "completed_unqualified", "lifecycle_event"],
      ["2026-10-17", "v1_debrief", "not_done", "declared_by_rider"],
    ]);
    const v2 = h.entries.filter((e): e is V2ExecutionEntry => e.source === "v2_guided_execution");
    // The decided session is planned; the performed side never takes its duration.
    expect(v2.map((e) => [e.date, e.decided.kind.status === "planned" && e.decided.kind.value, e.decided.durationMin.status === "planned" && e.decided.durationMin.value, e.performed.durationSeconds.status])).toEqual([
      ["2026-10-12", "DH_TECHNICAL", 90, "absent"],
      ["2026-10-13", "DH_TECHNICAL", 90, "absent"],
      ["2026-10-14", "STRENGTH_LOWER", 60, "absent"],
      ["2026-10-14", "STRENGTH_LOWER", 60, "absent"],
      ["2026-10-15", "STRENGTH_UPPER", 60, "absent"],
      ["2026-10-16", "AEROBIC_BASE", 45, "real"],
    ]);
  });

  it("DH: the passes and their evaluation as recorded; the partial session counts its missing passes, never fills them", async () => {
    const [full, partial] = (await read(admin, riderA, "2026-10-12", "2026-10-13")).entries as V2ExecutionEntry[];
    const passes = full!.performed.items[0]!.sets;
    expect(passes.map((p) => (p.success.status === "real" ? p.success.value : p.success.status === "absent" ? p.success.reason : p.success.status))).toEqual([true, false, "not_entered", ...passes.slice(3).map((_, i) => (i + 3) % 2 === 0)]);
    expect(full!.slots).toEqual({ prescribed: passes.length, withDoneResult: passes.length, withoutResult: 0, ambiguous: 0 });
    expect(partial!.slots).toEqual({ prescribed: full!.slots!.prescribed, withDoneResult: 1, withoutResult: full!.slots!.prescribed - 1, ambiguous: 0 });
    expect(partial!.performed.items[0]!.sets.map((p) => p.setNumber)).toEqual([1]);
  });

  it("Force: the stopped attempt keeps its real work; the corrected set reads its correction; load and RPE only where entered", async () => {
    const [stopped, done] = (await read(admin, riderA, "2026-10-14", "2026-10-14")).entries as V2ExecutionEntry[];
    const firstItem = (e: V2ExecutionEntry) => e.performed.items[0]!;
    expect(firstItem(stopped!).sets.map((s) => [s.setNumber, s.loadKg.status === "real" && s.loadKg.value, s.rpe.status === "real" ? s.rpe.value : s.rpe.status === "absent" ? s.rpe.reason : s.rpe.status])).toEqual([
      [1, 20, 7],
      [2, 20, "not_entered"],
    ]);
    expect(stopped!.slots!.withDoneResult).toBe(2);
    expect(done!.performed.correctionsApplied).toBe(1);
    const corrected = firstItem(done!).sets[0]!;
    expect([corrected.setNumber, corrected.corrected, corrected.loadKg.status === "real" && corrected.loadKg.value, corrected.rpe.status === "real" && corrected.rpe.value]).toEqual([1, true, 25, 8.5]);
    expect(done!.slots).toEqual({ prescribed: done!.slots!.prescribed, withDoneResult: done!.slots!.prescribed, withoutResult: 0, ambiguous: 0 });
    expect(done!.performed.sessionRpe).toEqual({ status: "absent", reason: "not_collected", source: null });
  });

  it("open attempt and endurance: an open attempt has no result and no end; endurance carries its recorded duration, distance and RPE", async () => {
    const [open, endurance] = (await read(admin, riderA, "2026-10-15", "2026-10-16")).entries as V2ExecutionEntry[];
    expect([open!.outcome, open!.performed.items, open!.lifecycle.endedAt.status, open!.lifecycle.events]).toEqual(["open", [], "absent", ["started"]]);
    expect([endurance!.unqualifiedReason, endurance!.performed.durationSeconds]).toEqual(["family_without_provable_realisation", { status: "real", basis: "recorded", value: 3150, source: "session_activity_results.duration_seconds" }]);
    const activity = endurance!.performed.activity;
    expect(activity.status === "real" && [activity.value.distanceM, activity.value.rpe]).toEqual([
      { status: "real", basis: "recorded", value: 21400, source: "session_activity_results.distance_m" },
      { status: "real", basis: "recorded", value: 6, source: "session_activity_results.rpe_actual" },
    ]);
  });

  it("V1: declared values, the load as an estimate, and a session not performed without duration or RPE", async () => {
    const h = await read(admin, riderA);
    const [declaredSession, notDone] = h.entries.filter((e): e is V1DebriefEntry => e.source === "v1_debrief");
    expect([declaredSession!.performed.durationMin, declaredSession!.performed.sessionRpe, declaredSession!.estimatedLoad]).toEqual([
      { status: "real", basis: "declared", value: 50, source: "completed_sessions.actual_duration_min" },
      { status: "real", basis: "declared", value: 6, source: "completed_sessions.rpe" },
      { status: "estimated", value: 30, source: "completed_sessions.session_load", method: "actual_duration_min × rpe / 10, derived by trigger trg_compute_session_load" },
    ]);
    expect(declaredSession!.decided.kind).toEqual({ status: "absent", reason: "not_linked", source: null });
    expect([notDone!.performed.durationMin.status, notDone!.performed.sessionRpe.status, notDone!.feedback.changeReason]).toEqual(["absent", "absent", { status: "real", basis: "declared", value: "time_life", source: "completed_sessions.change_reason" }]);
  });

  it("permissions: the rider's own client (RLS) reads exactly the same history; another rider reads nothing of it; each rider's history holds only their own records", async () => {
    const service = await read(admin, riderA);
    expect(await read(await getAthleteAuthClient(riderA), riderA)).toEqual(service);
    expect((await read(await getAthleteAuthClient(riderB), riderA)).entries).toEqual([]);
    const b = await read(admin, riderB);
    expect(b.entries.map((e) => [e.date, e.source, e.outcome])).toEqual([["2026-10-12", "v1_debrief", "completed"]]);
    expect(service.entries.some((e) => e.recordId === b.entries[0]!.recordId)).toBe(false);
  });

  it("read-only: reading the history changes no row of any table it reads", async () => {
    const before = await snapshot(riderA);
    await read(admin, riderA);
    await read(await getAthleteAuthClient(riderA), riderA);
    expect(await snapshot(riderA)).toBe(before);
  });

  // -----------------------------------------------------------------------------------------------------------------
  // HISTORY-READ-01 — exhaustiveness whatever the server's row cap. `cappedClient` cuts every row answer of the local
  // PostgREST to `cap` rows and rewrites Content-Range, exactly what a server `max_rows` of `cap` does; HEAD (exact
  // totals) pass through. `onRequest` runs before a request reaches the server (real writes between pages).
  // -----------------------------------------------------------------------------------------------------------------
  type Hook = (url: string, method: string) => Promise<void>;
  function cappedClient(key: string, cap: number, options: { token?: string; onRequest?: Hook; dropTotals?: boolean } = {}): SupabaseClient {
    const url = resolveTestSupabaseUrl();
    if (!isLoopbackSupabaseUrl(url)) throw new Error("cappedClient: local stack only");
    const capped: typeof fetch = async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      await options.onRequest?.(target, method);
      const res = await fetch(input, init);
      if (!target.includes("/rest/v1/") || !res.ok) return res;
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      if (method === "HEAD") {
        if (options.dropTotals) headers.delete("content-range");
        return new Response(null, { status: res.status, statusText: res.statusText, headers });
      }
      const body = await res.text();
      const rows: unknown = body === "" ? null : JSON.parse(body);
      if (method !== "GET" || !Array.isArray(rows) || rows.length <= cap) return new Response(body, { status: res.status, statusText: res.statusText, headers });
      const range = headers.get("content-range");
      if (range) {
        const [span, total] = range.split("/");
        const start = Number(span!.split("-")[0]);
        headers.set("content-range", `${start}-${start + cap - 1}/${total}`);
      }
      return new Response(JSON.stringify(rows.slice(0, cap)), { status: res.status, statusText: res.statusText, headers });
    };
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: capped, headers: options.token ? { Authorization: `Bearer ${options.token}` } : {} } });
  }
  const serviceKey = () => process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishableKey = () => process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  async function tokenOf(athleteId: string): Promise<string> {
    const { data } = await (await getAthleteAuthClient(athleteId)).auth.getSession();
    if (!data.session) throw new Error("no rider session");
    return data.session.access_token;
  }
  async function refusal(promise: Promise<unknown>): Promise<SessionResultHistoryReadError> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(SessionResultHistoryReadError);
    return error as SessionResultHistoryReadError;
  }
  /** A rider with three V1 debriefs (10-11, 10-12, 10-13), through persist_completed_session. */
  async function riderWithDebriefs(name: string): Promise<string> {
    const id = (await createTestAthlete(admin, `HISTORY-READ-01 ${name} ${randomUUID().slice(0, 6)}`)).athleteId;
    for (const [date, minutes] of [
      ["2026-10-11", 30],
      ["2026-10-12", 40],
      ["2026-10-13", 50],
    ] as const)
      await debrief(id, { session_date: date, session_type: "AEROBIC_BASE", completion_status: "done", actual_duration_min: minutes, rpe: 5, intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, post_leg_fatigue: 2, post_grip_fatigue: 1 });
    return id;
  }

  it("the simulated cap is real: a plain read through it returns at most `cap` rows", async () => {
    const { data } = await cappedClient(serviceKey(), 2).from("exercise_set_results").select("id").eq("athlete_id", riderA);
    expect((data ?? []).length).toBe(2);
    const { count } = await admin.from("exercise_set_results").select("id", { count: "exact", head: true }).eq("athlete_id", riderA);
    expect(count).toBeGreaterThan(10);
  });

  it("server caps of 1, 2 and 3 rows, pages of 2 and 5: exactly the unrestricted history, every table read in full", async () => {
    const reference = await read(admin, riderA);
    for (const [cap, pageSize] of [
      [1, 2],
      [2, 5],
      [3, 2],
    ] as const) {
      const facts = await readSessionResultHistoryFacts(cappedClient(serviceKey(), cap), riderA, FROM, TO, { pageSize });
      expect(sessionResultHistory(facts, FROM, TO), `cap ${cap}, page ${pageSize}`).toEqual(reference);
      for (const p of facts.proof) expect(p.read, `${p.context}, cap ${cap}`).toBe(p.total);
      // Pages of min(cap, page asked) rows, then the final empty page: the page size asked was never assumed.
      expect(facts.proof.find((p) => p.context === "exercise_set_results")!.pages, `cap ${cap}`).toBe(Math.ceil(facts.sets.length / Math.min(cap, pageSize)) + 1);
    }
  });

  it("under RLS with a cap of 1: the rider's own client reads the same full history; another rider's client reads nothing of it", async () => {
    const reference = await read(admin, riderA);
    const own = await readSessionResultHistoryFacts(cappedClient(publishableKey(), 1, { token: await tokenOf(riderA) }), riderA, FROM, TO, { pageSize: 3 });
    expect(sessionResultHistory(own, FROM, TO)).toEqual(reference);
    const other = await readSessionResultHistoryFacts(cappedClient(publishableKey(), 1, { token: await tokenOf(riderB) }), riderA, FROM, TO, { pageSize: 3 });
    expect(sessionResultHistory(other, FROM, TO).entries).toEqual([]);
    expect(other.proof.map((p) => [p.context, p.total])).toEqual([
      ["completed_sessions", 0],
      ["session_executions", 0],
    ]);
  });

  it("no exact total from the server: exhaustiveness cannot be proven → refused", async () => {
    expect((await refusal(readSessionResultHistoryFacts(cappedClient(serviceKey(), 2, { dropTotals: true }), riderA, FROM, TO))).code).toBe("count_unavailable");
  });

  it("a session declared while the history is read (real write between two pages) → refused, then read in full once stable", async () => {
    const rider = await riderWithDebriefs("added");
    let added = false;
    const onRequest: Hook = async (url, method) => {
      if (!added && method === "GET" && url.includes("/rest/v1/completed_sessions?") && url.includes("id=gt.")) {
        added = true;
        await debrief(rider, { session_date: "2026-10-14", session_type: "AEROBIC_BASE", completion_status: "done", actual_duration_min: 20, rpe: 4, intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, post_leg_fatigue: 1, post_grip_fatigue: 1 });
      }
    };
    const e = await refusal(readSessionResultHistoryFacts(cappedClient(serviceKey(), 1, { onRequest }), rider, FROM, TO, { pageSize: 1 }));
    expect([added, e.code, e.context]).toEqual([true, "changed_during_read", "completed_sessions"]);
    expect((await read(cappedClient(serviceKey(), 1), rider)).entries.map((x) => x.date)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
  });

  it("a session re-declared while the history is read (same rows, new versions) → refused by the second pass", async () => {
    const rider = await riderWithDebriefs("replaced");
    let replaced = false;
    const onRequest: Hook = async (url, method) => {
      if (!replaced && method === "GET" && url.includes("/rest/v1/completed_sessions?") && url.includes("id=gt.")) {
        replaced = true;
        // The rider corrects every day already declared (full replacement, same rows): one of them was already read.
        for (const date of ["2026-10-11", "2026-10-12", "2026-10-13"])
          await debrief(rider, { session_date: date, session_type: "AEROBIC_BASE", completion_status: "partial", actual_duration_min: 15, rpe: 6, intervention: { kind: "AEROBIC_BASE", load_profile: "LIGHT" }, post_leg_fatigue: 3, post_grip_fatigue: 1, change_reason: "fatigue_control" });
      }
    };
    const e = await refusal(readSessionResultHistoryFacts(cappedClient(serviceKey(), 1, { onRequest }), rider, FROM, TO, { pageSize: 1 }));
    expect([replaced, e.code, e.context]).toEqual([true, "changed_during_read", "completed_sessions"]);
    expect((await read(admin, rider)).entries.map((x) => x.outcome)).toEqual(["partial", "partial", "partial"]);
  });
});
