/**
 * P0-3 (HPM 2026-10-13, GO L1) — server lock of planned_sessions (migration 20261013140000) on the production schema
 * plus the P0-3 migrations. Real writes only:
 *  - the rider through PostgREST (JWT, RLS) for the contract;
 *  - two independent PostgreSQL connections (two psql processes) for concurrency: the rider exactly as PostgREST runs
 *    it (role authenticated + request.jwt.claims), record_session_execution and the purge as service_role.
 * Connection A takes its locks and keeps its transaction open (pg_sleep); B starts once A sleeps and is OBSERVED
 * waiting on the advisory lock (pg_stat_activity) before A commits. After every scenario: no running or completed
 * execution whose day's planned session differs from the one its decision was computed on.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertCompletedSession, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localDbContainer, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const ENABLED = localIntegrationRequested({ requirePublishableKey: true });
const HOLD_S = 4;
const FORCE = `'{"kind":"STRENGTH_UPPER","load_profile":"MODERATE"}'::jsonb`;

type Item = { kind: string; prescriptionItemId: string; measure: { type: string } };
type Structure = { family: string; blocks: { role: string; items: Item[] }[] };
interface Run { ok: boolean; out: string; err: string; ms: number }
interface Rider { athleteId: string; userId: string; client: SupabaseClient; dhDays: string[]; otherDays: string[] }
interface Decided { decisionId: string; fpId: string; structure: Structure }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One independent PostgreSQL connection (its own psql process), as the local database owner. */
function psql(app: string, sql: string): Promise<Run> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-f", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ ok: code === 0, out, err, ms: Date.now() - t0 }));
    p.stdin.end(`set application_name = ${lit(app)};\n${sql}`);
  });
}

async function until(sql: string, label: string, failed: () => Run | null = () => null): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (execLocalSql(sql).trim() === "t") return;
    const f = failed();
    if (f) throw new Error(`${label}: the other connection ended first (${f.err.trim() || f.out.trim()})`);
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
const sleeping = (app: string) => `select exists (select 1 from pg_stat_activity where application_name = ${lit(app)} and state = 'active' and query ilike 'select pg_sleep%');`;
const waitingOnAdvisory = (app: string) => `select exists (select 1 from pg_stat_activity where application_name = ${lit(app)} and wait_event_type = 'Lock' and wait_event = 'advisory');`;

/** A keeps its transaction open after `aSql`; B starts, is observed waiting on the advisory lock, then both end. */
async function holdThen<T>(aSql: string, b: (app: string) => Promise<T>, bWaiting: (app: string) => string): Promise<{ a: Run; b: T; bWaitedMs: number }> {
  const aApp = `p03a_${randomUUID().slice(0, 8)}`;
  const bApp = `p03b_${randomUUID().slice(0, 8)}`;
  let aDone: Run | null = null;
  const a = psql(aApp, `${aSql}\nselect pg_sleep(${HOLD_S});\ncommit;\n`).then((r) => (aDone = r));
  await until(sleeping(aApp), "A holds its transaction", () => aDone);
  const t0 = Date.now();
  const bp = b(bApp);
  await until(bWaiting(bApp), "B waits on the advisory lock", () => aDone);
  const [ra, rb] = await Promise.all([a, bp]);
  return { a: ra, b: rb, bWaitedMs: Date.now() - t0 };
}
const holdThenPsql = (aSql: string, bSql: string) => holdThen(aSql, (app) => psql(app, `${bSql}\ncommit;\n`), waitingOnAdvisory);

const asRider = (r: Rider, body: string, isolation = "") =>
  `begin${isolation};\nset local role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: r.userId, role: "authenticated" }))}, true) is not null;\n${body}\n`;
const asService = (body: string) => `begin;\nset local role service_role;\n${body}\n`;
const rse = (r: Rider, payload: unknown) => `select public.record_session_execution(${lit(r.athleteId)}, ${lit(JSON.stringify(payload))}::jsonb);`;
const updateSql = (r: Rider, date: string) =>
  `update public.planned_sessions set session_type = 'STRENGTH_B', intervention = ${FORCE}, source = 'manual', source_plan_version_id = null, source_generated_session_id = null where athlete_id = ${lit(r.athleteId)} and planned_date = ${lit(date)};`;
const deleteSql = (r: Rider, date: string) => `delete from public.planned_sessions where athlete_id = ${lit(r.athleteId)} and planned_date = ${lit(date)};`;
/** The web's upsert as PostgREST runs it (merge-duplicates on athlete_id, planned_date). */
const upsertSql = (r: Rider, date: string, kind = "STRENGTH_UPPER") =>
  `insert into public.planned_sessions (athlete_id, planned_date, session_type, intervention, planned_intent, source, is_committed, source_plan_version_id, source_generated_session_id)
   values (${lit(r.athleteId)}, ${lit(date)}, 'STRENGTH_B', ${lit(JSON.stringify({ kind, load_profile: "MODERATE" }))}::jsonb, null, 'manual', false, null, null)
   on conflict (athlete_id, planned_date) do update set session_type = excluded.session_type, intervention = excluded.intervention, planned_intent = excluded.planned_intent,
     source = excluded.source, is_committed = excluded.is_committed, source_plan_version_id = excluded.source_plan_version_id, source_generated_session_id = excluded.source_generated_session_id;`;
const jsonOut = (run: Run) => JSON.parse(run.out.split("\n").find((l) => l.startsWith("{"))!) as { status: string; code?: string };

/** Running or completed executions whose day's planned session is not the one their decision was computed on. */
function inconsistencies(r: Rider): number {
  return Number(
    execLocalSql(`select count(*) from public.session_executions e
       join public.decisions d on d.id = e.decision_id
       left join public.planned_sessions p on p.athlete_id = e.athlete_id and p.planned_date = e.session_date
      where e.athlete_id = ${lit(r.athleteId)}
        and (exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type = 'completed')
             or not exists (select 1 from public.execution_events ev where ev.execution_id = e.id and ev.event_type in ('completed', 'abandoned')))
        and (p.id is distinct from d.source_planned_session_id or p.updated_at is distinct from d.source_planned_session_updated_at);`).trim()
  );
}
const plannedRow = (r: Rider, date: string) => execLocalSql(`select coalesce((select id::text || '|' || updated_at::text || '|' || source from public.planned_sessions where athlete_id = ${lit(r.athleteId)} and planned_date = ${lit(date)}), 'none');`).trim();
const executionsOn = (r: Rider, date: string) => Number(execLocalSql(`select count(*) from public.session_executions where athlete_id = ${lit(r.athleteId)} and session_date = ${lit(date)};`).trim());

describe.skipIf(!ENABLED)("P0-3 — atomic planned_sessions lock (local, production schema + P0-3 migrations)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  const report: Record<string, unknown> = {};

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  afterAll(() => {
    if (process.env.P0_3_REPORT) writeFileSync(process.env.P0_3_REPORT, JSON.stringify(report, null, 2));
  });

  async function rider(name: string): Promise<Rider> {
    const { athleteId } = await createTestAthlete(admin, `P0-3 lock ${name} ${randomUUID().slice(0, 6)}`);
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
    const rows = data as { planned_date: string; intervention: { kind: string } | null }[];
    const { data: a } = await admin.from("athletes").select("user_id").eq("id", athleteId).single();
    const dhDays = rows.filter((x) => x.intervention?.kind === "DH_TECHNICAL").map((x) => x.planned_date);
    expect(dhDays.length).toBeGreaterThanOrEqual(4);
    return {
      athleteId,
      userId: (a as { user_id: string }).user_id,
      client: await getAthleteAuthClient(athleteId),
      dhDays,
      otherDays: rows.filter((x) => x.intervention !== null && x.intervention.kind !== "DH_TECHNICAL").map((x) => x.planned_date),
    };
  }
  async function decide(r: Rider, day: string): Promise<Decided> {
    await insertCheckin(admin, r.athleteId, day);
    const run = await runDailyFor(admin, r.athleteId, day);
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", run.persistence.decision_id).single();
    const fp = data as { id: string; structure: Structure };
    return { decisionId: run.persistence.decision_id, fpId: fp.id, structure: fp.structure };
  }
  function session(d: Decided, day: string) {
    const id = randomUUID();
    const pass = d.structure.blocks.find((b) => b.role === "main")!.items[0]!;
    return {
      id,
      start: { execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: d.fpId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }] },
      complete: { sets: [{ id: randomUUID(), execution_id: id, prescription_item_id: pass.prescriptionItemId, set_number: 1, done: true, measure_type: pass.measure.type, measure_value: pass.measure.type === "pass" ? null : 8, occurred_at: `${day}T17:30:00Z` }], events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${day}T18:00:00Z` }] },
      abandon: { events: [{ id: randomUUID(), execution_id: id, event_type: "abandoned", occurred_at: `${day}T17:20:00Z` }] },
    };
  }
  const record = async (r: Rider, payload: unknown) => (await admin.rpc("record_session_execution", { p_athlete_id: r.athleteId, p_payload: payload })).data as { status: string; code?: string };
  const riderUpdate = (r: Rider, date: string) => r.client.from("planned_sessions").update({ session_type: "STRENGTH_B", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, source: "manual" }).eq("athlete_id", r.athleteId).eq("planned_date", date);
  const riderUpsert = (r: Rider, date: string) =>
    r.client.from("planned_sessions").upsert({ athlete_id: r.athleteId, planned_date: date, session_type: "STRENGTH_B", intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
  const riderDelete = (r: Rider, date: string) => r.client.from("planned_sessions").delete().eq("athlete_id", r.athleteId).eq("planned_date", date);
  const riderMove = (r: Rider, from: string, to: string) => r.client.from("planned_sessions").update({ planned_date: to }).eq("athlete_id", r.athleteId).eq("planned_date", from);

  it("contract — rider JWT (PostgREST) on a started day: update, web upsert, delete, move out and move in are refused (NX201); nothing changes", async () => {
    const r = await rider("contract");
    const [x, y] = r.dhDays;
    const d = await decide(r, x!);
    expect(await record(r, session(d, x!).start)).toMatchObject({ status: "ok" });
    const before = [plannedRow(r, x!), plannedRow(r, y!)];
    const attempts = {
      update: (await riderUpdate(r, x!)).error,
      upsert: (await riderUpsert(r, x!)).error,
      delete: (await riderDelete(r, x!)).error,
      moveOut: (await riderMove(r, x!, "2026-10-25")).error,
      moveIn: (await riderMove(r, y!, x!)).error, // NEW (athlete, date) locked: refused before the unique constraint
    };
    report.contractStarted = Object.fromEntries(Object.entries(attempts).map(([k, e]) => [k, e ? `${e.code} ${e.message} ${e.details}` : "accepted"]));
    for (const e of Object.values(attempts)) expect([e?.code, e?.message, e?.details]).toEqual(["NX201", "planned_session_day_locked", x]);
    expect([plannedRow(r, x!), plannedRow(r, y!)]).toEqual(before);
    expect(inconsistencies(r)).toBe(0);
  });

  it("contract — completed V2 day and legacy (V1) done day refused; legacy skipped day and an abandoned-only day stay editable; a restart follows", async () => {
    const r = await rider("completed");
    const [x, w, z] = r.dhDays;
    const d = await decide(r, x!);
    const s = session(d, x!);
    expect(await record(r, s.start)).toMatchObject({ status: "ok" });
    expect(await record(r, s.complete)).toMatchObject({ status: "ok" });
    expect((await riderUpdate(r, x!)).error?.message).toBe("planned_session_day_locked");
    expect((await riderDelete(r, x!)).error?.message).toBe("planned_session_day_locked");

    const [legacyDone, legacySkipped] = r.otherDays;
    await insertCompletedSession(admin, r.athleteId, legacyDone!, "STRENGTH_A", { kind: "STRENGTH_LOWER", load_profile: "MODERATE" });
    await insertCompletedSession(admin, r.athleteId, legacySkipped!, "STRENGTH_A", { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, { completionStatus: "skipped" });
    expect((await riderUpdate(r, legacyDone!)).error?.message).toBe("planned_session_day_locked");
    expect((await riderUpdate(r, legacySkipped!)).error).toBeNull();

    // Abandon, then modification: allowed; the new decision's session starts (restart after abandon).
    const dw = await decide(r, w!);
    const sw = session(dw, w!);
    expect(await record(r, sw.start)).toMatchObject({ status: "ok" });
    expect((await riderUpdate(r, w!)).error?.message).toBe("planned_session_day_locked");
    expect(await record(r, sw.abandon)).toMatchObject({ status: "ok" });
    expect((await riderUpsert(r, w!)).error).toBeNull();
    const again = await runDailyFor(admin, r.athleteId, w!);
    const { data: fp } = await admin.from("decision_final_prescriptions").select("id, structure, active_session_origin").eq("decision_id", again.persistence.decision_id).single();
    expect((fp as { active_session_origin: string }).active_session_origin).toBe("manual_override_new_kind");
    expect(await record(r, session({ decisionId: again.persistence.decision_id, fpId: (fp as { id: string }).id, structure: (fp as { structure: Structure }).structure }, w!).start)).toMatchObject({ status: "ok" });
    // An untouched future day stays freely editable.
    expect((await riderUpsert(r, z!)).error).toBeNull();
    expect((await riderDelete(r, z!)).error).toBeNull();
    expect(inconsistencies(r)).toBe(0);
  });

  it("concurrency — a session start holds the lock: the rider's UPDATE, then DELETE, wait on it and are refused; the session exists", async () => {
    const r = await rider("start-first");
    const out: Record<string, unknown> = {};
    for (const [label, day, write] of [["update", r.dhDays[0]!, updateSql], ["delete", r.dhDays[1]!, deleteSql]] as const) {
      const d = await decide(r, day);
      const before = plannedRow(r, day);
      const res = await holdThenPsql(asService(rse(r, session(d, day).start)), asRider(r, write(r, day)));
      out[label] = { a: jsonOut(res.a), bOk: res.b.ok, bError: res.b.err.trim().split("\n")[0], bWaitedMs: res.bWaitedMs };
      expect(jsonOut(res.a)).toMatchObject({ status: "ok" });
      expect(res.b.ok).toBe(false);
      expect(res.b.err).toContain("planned_session_day_locked");
      expect(res.b.err).not.toContain("deadlock");
      expect([plannedRow(r, day), executionsOn(r, day)]).toEqual([before, 1]);
    }
    report.startFirst = out;
    expect(inconsistencies(r)).toBe(0);
  });

  it("concurrency — the rider's UPDATE, then DELETE, hold the lock: the session start waits on it and is refused (final_prescription_not_current); no session", async () => {
    const r = await rider("write-first");
    const out: Record<string, unknown> = {};
    for (const [label, day, write] of [["update", r.dhDays[0]!, updateSql], ["delete", r.dhDays[1]!, deleteSql]] as const) {
      const d = await decide(r, day);
      const res = await holdThenPsql(asRider(r, write(r, day)), asService(rse(r, session(d, day).start)));
      out[label] = { aOk: res.a.ok, b: res.b.ok ? jsonOut(res.b) : res.b.err.trim(), bWaitedMs: res.bWaitedMs };
      expect(res.a.ok).toBe(true);
      expect(res.b.ok).toBe(true);
      expect(jsonOut(res.b)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
      expect(executionsOn(r, day)).toBe(0);
      expect(plannedRow(r, day).endsWith("|manual") || plannedRow(r, day) === "none").toBe(true);
    }
    report.writeFirst = out;
    expect(inconsistencies(r)).toBe(0);
  });

  it("concurrency — two tabs on the same day (delete/upsert, upsert/delete, upsert/upsert): the second waits its turn, both commit, last write wins, no deadlock", async () => {
    const r = await rider("two-tabs");
    const day = r.otherDays[0]!;
    const cases = [
      ["delete then upsert", deleteSql(r, day), upsertSql(r, day, "STRENGTH_UPPER"), "STRENGTH_UPPER"],
      ["upsert then delete", upsertSql(r, day, "STRENGTH_LOWER"), deleteSql(r, day), "none"],
      ["upsert then upsert", upsertSql(r, day, "STRENGTH_LOWER"), upsertSql(r, day, "STRENGTH_UPPER"), "STRENGTH_UPPER"],
    ] as const;
    const out: Record<string, unknown> = {};
    for (const [label, a, b, expected] of cases) {
      const res = await holdThenPsql(asRider(r, a), asRider(r, b));
      out[label] = { aOk: res.a.ok, bOk: res.b.ok, bWaitedMs: res.bWaitedMs, err: (res.a.err + res.b.err).trim() };
      expect([res.a.ok, res.b.ok, res.a.err + res.b.err]).toEqual([true, true, ""]);
      const kind = execLocalSql(`select coalesce((select intervention->>'kind' from public.planned_sessions where athlete_id = ${lit(r.athleteId)} and planned_date = ${lit(day)}), 'none');`).trim();
      expect(kind).toBe(expected);
    }
    report.twoTabs = out;
  });

  it("concurrency — 20 rounds of two simultaneous writes on the same day (no hold): every write commits, 0 deadlock", async () => {
    const r = await rider("stress");
    const day = r.otherDays[1]!;
    let failures = 0;
    let deadlocks = 0;
    for (let i = 0; i < 20; i += 1) {
      const pick = (k: number) => (k % 2 === 0 ? upsertSql(r, day, k % 3 === 0 ? "STRENGTH_LOWER" : "STRENGTH_UPPER") : deleteSql(r, day));
      const tx = (k: number) => `${asRider(r, pick(k))}select pg_sleep(${(Math.random() * 0.05).toFixed(3)});\ncommit;\n`;
      const runs = await Promise.all([psql(`p03s_${i}a`, tx(i)), psql(`p03s_${i}b`, tx(i + 1))]);
      for (const run of runs) {
        if (!run.ok) failures += 1;
        if (run.err.includes("deadlock")) deadlocks += 1;
      }
    }
    report.stress = { rounds: 20, writes: 40, failures, deadlocks };
    expect([failures, deadlocks]).toEqual([0, 0]);
  });

  it("plan acceptance on X with a session running on X, completed on Y, and starting concurrently on Z: X, Y, Z kept (skipped_completed), the rest projected, no warning, nothing rewritten", async () => {
    const r = await rider("acceptance");
    const [x, y, z] = r.dhDays;
    const dx = await decide(r, x!);
    const sx = session(dx, x!);
    expect(await record(r, sx.start)).toMatchObject({ status: "ok" });
    const dy = await decide(r, y!);
    const sy = session(dy, y!);
    expect(await record(r, sy.start)).toMatchObject({ status: "ok" });
    expect(await record(r, sy.complete)).toMatchObject({ status: "ok" });
    const dz = await decide(r, z!);
    const sz = session(dz, z!);

    const p2 = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: r.athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: x! });
    if (p2.status !== "persisted") throw new Error("plan 2");
    const kept = [x!, y!, z!].map((d) => plannedRow(r, d));
    const frozen = `select md5(coalesce(string_agg(id::text || structure::text, ',' order by id), '')) || '|' || (select count(*) from public.decisions where athlete_id = ${lit(r.athleteId)}) from public.decision_final_prescriptions where athlete_id = ${lit(r.athleteId)};`;
    const frozenBefore = execLocalSql(frozen).trim();
    const end = new Date(Date.parse(`${x}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);

    // Z: the session start holds the lock while the acceptance projects (the projection waits for it).
    const res = await holdThen(
      asService(rse(r, sz.start)),
      () => acceptTrainingPlanVersion(admin, r.athleteId, p2.planVersionId, x!, end),
      () => `select exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and wait_event = 'advisory' and query ilike '%project_training_plan%');`
    );
    expect(jsonOut(res.a)).toMatchObject({ status: "ok" });
    const outcome = res.b;
    const byDate = new Map(outcome.projection!.plannedSessions.map((s) => [s.date, s.outcome]));
    report.acceptance = { warnings: outcome.warnings, x: byDate.get(x!), y: byDate.get(y!), z: byDate.get(z!), outcomes: outcome.projection!.plannedSessions, projectionWaitedMs: res.bWaitedMs };
    expect(outcome.warnings).toEqual([]);
    expect([byDate.get(x!), byDate.get(y!), byDate.get(z!)]).toEqual(["skipped_completed", "skipped_completed", "skipped_completed"]);
    expect([x!, y!, z!].map((d) => plannedRow(r, d))).toEqual(kept);
    expect(outcome.projection!.plannedSessions.filter((s) => s.outcome === "projected").length).toBeGreaterThan(0);
    const { count: newLineage } = await admin.from("planned_sessions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId).eq("source_plan_version_id", p2.planVersionId);
    expect(newLineage).toBeGreaterThan(0);
    expect(execLocalSql(frozen).trim()).toBe(frozenBefore); // decisions and final prescriptions untouched
    const current = execLocalSql(`select string_agg(is_current::text, ',' order by decision_date) from public.daily_decision_currency where decision_id in (${[dx, dy, dz].map((d) => lit(d.decisionId)).join(", ")});`).trim();
    expect(current).toBe("true,true,true"); // the days' decisions stay the current ones: Today shows the session actually done or running
    expect(await record(r, sx.complete)).toMatchObject({ status: "ok" }); // the running session completes
    expect(inconsistencies(r)).toBe(0);
  });

  it("purge concurrent with rider writes: purge first → the rider's DELETE finds nothing, an upsert is refused cleanly; rider first → the purge waits then completes; 0 deadlock", async () => {
    const purge = (r: Rider) => asService(`select public.purge_athlete_account(${lit(r.athleteId)}) is not null;`);
    const left = (r: Rider) => execLocalSql(`select (select count(*) from public.planned_sessions where athlete_id = ${lit(r.athleteId)}) + (select count(*) from public.athletes where id = ${lit(r.athleteId)});`).trim();
    const out: Record<string, unknown> = {};

    const r1 = await rider("purge-first-delete");
    const s1 = session(await decide(r1, r1.dhDays[0]!), r1.dhDays[0]!);
    expect(await record(r1, s1.start)).toMatchObject({ status: "ok" });
    const a = await holdThenPsql(purge(r1), asRider(r1, deleteSql(r1, r1.dhDays[1]!)));
    out.purgeFirstDelete = { aOk: a.a.ok, bOk: a.b.ok, bErr: a.b.err.trim(), bWaitedMs: a.bWaitedMs };
    expect([a.a.ok, a.b.ok, a.b.err]).toEqual([true, true, ""]);
    expect(left(r1)).toBe("0");

    const r2 = await rider("purge-first-upsert");
    const b = await holdThenPsql(purge(r2), asRider(r2, upsertSql(r2, r2.dhDays[1]!)));
    out.purgeFirstUpsert = { aOk: b.a.ok, bOk: b.b.ok, bErr: b.b.err.trim().split("\n")[0], bWaitedMs: b.bWaitedMs };
    expect([b.a.ok, b.b.ok]).toEqual([true, false]);
    expect(b.b.err).toMatch(/row-level security|foreign key/);
    expect(b.b.err).not.toContain("deadlock");
    expect(left(r2)).toBe("0");

    const r3 = await rider("rider-first");
    const c = await holdThenPsql(asRider(r3, updateSql(r3, r3.dhDays[1]!)), purge(r3));
    out.riderFirst = { aOk: c.a.ok, bOk: c.b.ok, err: (c.a.err + c.b.err).trim(), bWaitedMs: c.bWaitedMs };
    expect([c.a.ok, c.b.ok, c.a.err + c.b.err]).toEqual([true, true, ""]);
    expect(left(r3)).toBe("0");
    report.purgeConcurrency = out;
  });

  it("purge of an account with V1 and V2 completed sessions, a running one, and generated lineage: complete, nothing left", async () => {
    const r = await rider("purge-full");
    const [x, y] = r.dhDays;
    const sy = session(await decide(r, y!), y!);
    expect(await record(r, sy.start)).toMatchObject({ status: "ok" });
    expect(await record(r, sy.complete)).toMatchObject({ status: "ok" });
    expect(await record(r, session(await decide(r, x!), x!).start)).toMatchObject({ status: "ok" });
    const [legacyDone, legacySkipped] = r.otherDays;
    await insertCompletedSession(admin, r.athleteId, legacyDone!, "STRENGTH_A", { kind: "STRENGTH_LOWER", load_profile: "MODERATE" });
    await insertCompletedSession(admin, r.athleteId, legacySkipped!, "STRENGTH_A", { kind: "STRENGTH_LOWER", load_profile: "MODERATE" }, { completionStatus: "skipped" });
    // The legacy done day keeps its generated lineage: the purge's plan deletions set it to NULL (ON DELETE SET NULL) on a locked day.
    expect(execLocalSql(`select source_plan_version_id is not null and source_generated_session_id is not null from public.planned_sessions where athlete_id = ${lit(r.athleteId)} and planned_date = ${lit(legacyDone!)};`).trim()).toBe("t");
    const { data, error } = await admin.rpc("purge_athlete_account", { p_athlete_id: r.athleteId });
    expect(error).toBeNull();
    const deleted = (data as { deleted: Record<string, number> }).deleted;
    report.purgeFull = deleted;
    expect(deleted.session_executions).toBe(2);
    expect(deleted.athletes).toBe(1);
    const left = execLocalSql(
      `select ${["planned_sessions", "session_executions", "execution_events", "completed_sessions", "decisions", "decision_final_prescriptions", "daily_checkins"].map((t) => `(select count(*) from public.${t} where athlete_id = ${lit(r.athleteId)})`).join(" + ")};`
    ).trim();
    expect(left).toBe("0");
  });

  it("no bypass for the rider: set_config, the helper, the trigger function and the purge are not reachable through the API; another isolation level is refused", async () => {
    const r = await rider("bypass");
    const rpc = async (fn: string, args: Record<string, unknown>) => (await r.client.rpc(fn, args)).error?.code ?? "accepted";
    const calls = {
      set_config: await rpc("set_config", { setting_name: "nalynt.athlete_purge_txid", new_value: "1", is_local: true }),
      helper: await rpc("planned_session_day_has_execution", { p_athlete_id: r.athleteId, p_date: r.dhDays[0] }),
      trigger_function: await rpc("enforce_planned_session_day_lock", {}),
      purge: await rpc("purge_athlete_account", { p_athlete_id: r.athleteId }),
    };
    report.bypass = calls;
    for (const code of Object.values(calls)) expect(code).not.toBe("accepted");
    const rr = await psql(`p03rr_${randomUUID().slice(0, 6)}`, `${asRider(r, updateSql(r, r.otherDays[0]!), " isolation level repeatable read")}commit;\n`);
    expect(rr.ok).toBe(false);
    expect(rr.err).toContain("planned_session_day_lock_requires_read_committed");
    // The purge marker of another transaction id does not open anything.
    const stale = await psql(`p03mk_${randomUUID().slice(0, 6)}`, `begin;\nselect set_config('nalynt.athlete_purge_txid', '1', true) is not null;\nset local role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: r.userId, role: "authenticated" }))}, true) is not null;\n${deleteSql(r, r.dhDays[0]!)}\ncommit;\n`);
    expect(stale.ok).toBe(true); // a free day: allowed by the normal rules, not by the marker
    const s = session(await decide(r, r.dhDays[1]!), r.dhDays[1]!);
    expect(await record(r, s.start)).toMatchObject({ status: "ok" });
    const staleLocked = await psql(`p03mk_${randomUUID().slice(0, 6)}`, `begin;\nselect set_config('nalynt.athlete_purge_txid', '1', true) is not null;\nset local role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: r.userId, role: "authenticated" }))}, true) is not null;\n${deleteSql(r, r.dhDays[1]!)}\ncommit;\n`);
    expect(staleLocked.err).toContain("planned_session_day_locked");
  });
});
