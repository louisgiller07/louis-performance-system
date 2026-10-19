/**
 * P0-3 (HPM 2026-10-13, GO correction serveur sécurité santé) — no training action under a health suspension
 * (migration 20261013160000). Everything through the local Edge runtime with the rider's JWT (daily-run,
 * session-execution), check-ins edited by the rider (RLS), and every outcome checked on the PERSISTED rows.
 *
 * Suspension = an open follow-up health signal (A7 types), an open concussion signal for a DH session (A5), or the
 * day's latest decision a REST ruled by the Safety layer (A1–A4, A6, A7). A stale day decision (check-in changed,
 * daily-run not re-run) is refused too (daily_decision_not_current). An ordinary REST is not a suspension.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertRace, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays } from "../../src/supabase/productCalendar.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";

type Item = { kind: string; prescriptionItemId: string; measure: { type: string; count?: number } };
type Structure = { family: string; blocks: { role: string; items: Item[] }[] };
type Body = Record<string, unknown>;
const NO_PAIN = { pain: false, pain_intensity: null, pain_new: false, pain_location_code: null, pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false };
const SEVERE_PAIN = { pain: true, pain_intensity: 8, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: false };

describe.skipIf(!EDGE)("P0-3 — health suspension enforcement on guided sessions (local Edge, rider JWT, persisted rows)", { timeout: 300_000 }, () => {
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
  const code = (r: { status: number; body: Body }) => (r.status === 200 ? "ok" : `${r.status} ${(r.body.error as { code?: string } | undefined)?.code ?? "?"}`);

  /** A V2 rider with an accepted plan; returns its DH days. */
  async function rider(label: string) {
    const { athleteId } = await createTestAthlete(admin, `P0-3 health ${label} ${randomUUID().slice(0, 6)}`);
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
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).order("planned_date");
    const dhDays = (data as { planned_date: string; intervention: { kind: string } | null }[]).filter((r) => r.intervention?.kind === "DH_TECHNICAL").map((r) => r.planned_date);
    return { athleteId, planVersionId: p.planVersionId, client: await getAthleteAuthClient(athleteId), dhDays };
  }
  type Rider = Awaited<ReturnType<typeof rider>>;

  /** Check-in, daily-run (Edge), start (Edge) and one recorded pass: a guided DH session running on `day`. */
  async function running(r: Rider, day: string) {
    await insertCheckin(admin, r.athleteId, day);
    const run = await invoke(r.client, "daily-run", { date: day });
    expect([run.status, run.body.finalPrescriptionStatus]).toEqual([200, "created"]);
    const fp = run.body.finalPrescription as { id: string; structure: Structure };
    const pass = fp.structure.blocks.find((b) => b.role === "main")!.items[0]!;
    const id = randomUUID();
    let n = 0;
    const s = {
      id,
      fp,
      start: { execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }] },
      ev: (event_type: string) => ({ events: [{ id: randomUUID(), execution_id: id, event_type, occurred_at: `${day}T17:${String(20 + (n += 1)).padStart(2, "0")}:00Z` }] }),
      pass: (setNumber: number) => ({ id: randomUUID(), execution_id: id, prescription_item_id: pass.prescriptionItemId, set_number: setNumber, done: true, measure_type: pass.measure.type, measure_value: pass.measure.type === "pass" ? null : 8, occurred_at: `${day}T17:${String(10 + setNumber).padStart(2, "0")}:00Z` }),
    };
    expect(code(await invoke(r.client, "session-execution", s.start))).toBe("ok");
    const first = s.pass(1);
    expect(code(await invoke(r.client, "session-execution", { sets: [first] }))).toBe("ok");
    return { ...s, first };
  }
  type Running = Awaited<ReturnType<typeof running>>;

  async function editCheckin(r: Rider, day: string, values: Record<string, unknown>) {
    const { error } = await r.client.from("daily_checkins").update(values).eq("athlete_id", r.athleteId).eq("checkin_date", day);
    if (error) throw new Error(error.message);
  }
  async function rerun(r: Rider, day: string) {
    const run = await invoke(r.client, "daily-run", { date: day });
    const plan = run.body.dailyPlan as { decision: string; final_session: { kind: string }; triggered_rules: { rule_id: string; layer: string }[] };
    return { status: run.status, decision: plan?.decision, finalKind: plan?.final_session.kind, rules: (plan?.triggered_rules ?? []).map((x) => `${x.layer}:${x.rule_id}`) };
  }
  /** What is persisted for the execution: event types in server order and the result rows. */
  function persisted(s: Running) {
    return JSON.parse(
      execLocalSql(`select json_build_object(
        'events', (select coalesce(json_agg(event_type order by event_seq), '[]') from public.execution_events where execution_id = ${lit(s.id)}),
        'results', (select count(*) from public.exercise_set_results where execution_id = ${lit(s.id)}),
        'resultsFingerprint', (select md5(coalesce(string_agg(id::text || done::text || coalesce(supersedes_id::text, '-'), ',' order by id), '')) from public.exercise_set_results where execution_id = ${lit(s.id)}));`).trim()
    ) as { events: string[]; results: number; resultsFingerprint: string };
  }
  const attempt = async (r: Rider, payload: unknown) => code(await invoke(r.client, "session-execution", payload));

  it("1–2, 6–8 — DH started, a pass recorded, severe pain 8/10 → REST A6: new pass, correction, resume, closure with results and completion refused; pause, replay and abandon accepted; results kept", async () => {
    const r = await rider("a6");
    const day = r.dhDays[0]!;
    const s = await running(r, day);
    await editCheckin(r, day, SEVERE_PAIN);
    const suspension = await rerun(r, day);
    expect([suspension.decision, suspension.rules.includes("A:A6")]).toEqual(["REST", true]);
    const before = persisted(s);

    const out = {
      newPass: await attempt(r, { sets: [s.pass(2)] }),
      correction: await attempt(r, { sets: [{ ...s.pass(1), supersedes_id: s.first.id, done: false }] }),
      pause: await attempt(r, s.ev("paused")),
      resume: await attempt(r, s.ev("resumed")),
      closureWithNewResult: await attempt(r, { sets: [s.pass(2)], ...s.ev("completed") }),
      closureWithoutNewResult: await attempt(r, s.ev("completed")),
      replayOfRecordedPass: await attempt(r, { sets: [s.first] }),
      replayOfStart: await attempt(r, s.start),
      abandon: await attempt(r, s.ev("abandoned")),
    };
    const after = persisted(s);
    report.a6 = { suspension, attempts: out, before, after };
    expect(out).toEqual({
      newPass: "409 health_suspended",
      correction: "409 health_suspended",
      pause: "ok",
      resume: "409 health_suspended",
      closureWithNewResult: "409 health_suspended",
      closureWithoutNewResult: "409 health_suspended",
      replayOfRecordedPass: "ok",
      replayOfStart: "ok",
      abandon: "ok",
    });
    expect(after.events).toEqual(["started", "paused", "abandoned"]);
    expect([after.results, after.resultsFingerprint]).toEqual([before.results, before.resultsFingerprint]); // results before the suspension kept, nothing added
    // The abandoned session is not a completion: M1's recent-load bridge and the web never count it as done.
    const counted = Number(execLocalSql(`select count(*) from public.execution_events where execution_id = ${lit(s.id)} and event_type = 'completed';`).trim());
    expect(counted).toBe(0);
  });

  it("3 — a signal persisted before any new daily-run: a check-in edited (stale decision) and an open follow-up signal from another day both stop the running session", async () => {
    const r = await rider("before-rerun");
    const [x, y] = r.dhDays;
    const sx = await running(r, x!);
    await editCheckin(r, x!, SEVERE_PAIN); // no daily-run yet: the day's decision is stale
    const stale = { newPass: await attempt(r, { sets: [sx.pass(2)] }), completion: await attempt(r, sx.ev("completed")) };

    // An open follow-up signal created by a daily-run of ANOTHER date (A6 on y): x's decision is untouched.
    const r2 = await rider("open-flag");
    const [a, b] = r2.dhDays;
    const sa = await running(r2, a!);
    await insertCheckin(admin, r2.athleteId, b!, SEVERE_PAIN);
    const other = await rerun(r2, b!);
    const flag = execLocalSql(`select string_agg(flag_type::text || ':' || status::text, ',') from public.health_flags where athlete_id = ${lit(r2.athleteId)};`).trim();
    const openFlag = { otherDay: other.rules, flag, newPass: await attempt(r2, { sets: [sa.pass(2)] }), resume: await attempt(r2, sa.ev("paused")) === "ok" ? await attempt(r2, sa.ev("resumed")) : "pause refused" };
    report.beforeRerun = { stale, openFlag };
    expect(stale).toEqual({ newPass: "409 daily_decision_not_current", completion: "409 daily_decision_not_current" });
    expect([openFlag.flag, openFlag.newPass, openFlag.resume]).toEqual(["injury_suspect:active", "409 health_suspended", "409 health_suspended"]);
    expect([persisted(sx).results, persisted(sa).results]).toEqual([1, 1]);
  });

  it("4 — other REST ruled by the Safety layer (A2 new severe pain, A3 illness, A4 objective criterion, A1 concussion) refuse the training actions", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["A2", { ...SEVERE_PAIN, pain_new: true }, "A:A2"],
      ["A3", { fever_or_illness: true }, "A:A3"],
      ["A4", { pain: true, pain_intensity: 3, pain_new: false, pain_location_code: "knee_R", pain_traumatic: true, pain_function_loss: false, pain_getting_worse: false }, "A:A4"],
      ["A1", { suspected_concussion: true }, "A:A1"],
    ];
    const out: Record<string, unknown> = {};
    for (const [rule, values, expected] of cases) {
      const r = await rider(rule);
      const day = r.dhDays[0]!;
      const s = await running(r, day);
      await editCheckin(r, day, values);
      const d = await rerun(r, day);
      const res = { decision: d.decision, ruled: d.rules.includes(expected), newPass: await attempt(r, { sets: [s.pass(2)] }), completion: await attempt(r, s.ev("completed")), abandon: await attempt(r, s.ev("abandoned")), results: persisted(s).results };
      out[rule] = res;
      expect(res).toEqual({ decision: "REST", ruled: true, newPass: "409 health_suspended", completion: "409 health_suspended", abandon: "ok", results: 1 });
    }
    report.safetyRest = out;
  });

  it("5 — no false block: an ordinary REST (race protocol T-2, layer B) and a non-health check-in change keep the session going to completion", async () => {
    const r = await rider("ordinary-rest");
    const day = r.dhDays[0]!;
    const s = await running(r, day);
    await insertRace(admin, r.athleteId, { event_name: "P0-3 race", start_date: addCalendarDays(day, 2), end_date: addCalendarDays(day, 3), priority: "A", race_format: "HOT_TRAIL_2DAY", series: "HOT_TRAIL_SERIES" });
    await editCheckin(r, day, { ...NO_PAIN, sleep_quality: 2 });
    const d = await rerun(r, day);
    const out = { decision: d.decision, finalKind: d.finalKind, rules: d.rules, newPass: await attempt(r, { sets: [s.pass(2)] }), pause: await attempt(r, s.ev("paused")), resume: await attempt(r, s.ev("resumed")), completion: await attempt(r, s.ev("completed")) };
    report.ordinaryRest = out;
    expect(out.finalKind).toBe("REST");
    expect(out.decision).not.toBe("REST");
    expect(out.rules.some((x) => x.startsWith("A:"))).toBe(false);
    expect([out.newPass, out.pause, out.resume, out.completion]).toEqual(["ok", "ok", "ok", "ok"]);
    expect(persisted(s).events).toEqual(["started", "paused", "resumed", "completed"]);
  });

  it("9 / 10 — a session completed before the suspension stays completed and frozen; the kept day of a new plan (blocked decision, no health rule) is not a suspension", async () => {
    const r = await rider("completed-then-a6");
    const day = r.dhDays[0]!;
    const s = await running(r, day);
    expect(await attempt(r, s.ev("completed"))).toBe("ok");
    await editCheckin(r, day, SEVERE_PAIN);
    const d = await rerun(r, day);
    const frozen = { decision: d.decision, newPass: await attempt(r, { sets: [s.pass(2)] }), newStart: await (async () => {
      const id = randomUUID();
      return attempt(r, { execution: { ...s.start.execution, id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T19:00:00Z` }] });
    })() };
    expect(persisted(s).events).toEqual(["started", "completed"]);
    expect(persisted(s).results).toBe(1);

    // Kept day: running session, new plan accepted on the day (skipped_completed), daily-run again → KEEP blocked
    // (no lineage in the new version) — not a health rule: the session goes on and completes.
    const k = await rider("kept-day");
    const kd = k.dhDays[0]!;
    const ks = await running(k, kd);
    const p2 = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: k.athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: kd });
    if (p2.status !== "persisted") throw new Error("plan 2");
    const accepted = await acceptTrainingPlanVersion(admin, k.athleteId, p2.planVersionId, kd, addCalendarDays(kd, 13));
    const kr = await invoke(k.client, "daily-run", { date: kd });
    const kept = { acceptanceOutcome: accepted.projection!.plannedSessions.filter((x) => x.date === kd).map((x) => x.outcome), rerun: kr.body.finalPrescriptionStatus, newPass: await attempt(k, { sets: [ks.pass(2)] }), completion: await attempt(k, ks.ev("completed")) };
    report.completedAndKept = { frozen, kept };
    expect(frozen).toEqual({ decision: "REST", newPass: "409 execution_terminal", newStart: expect.stringMatching(/^4\d\d /) });
    expect(kept).toEqual({ acceptanceOutcome: ["skipped_completed"], rerun: "blocked", newPass: "ok", completion: "ok" });
  });
});
