/**
 * POWER-GUARD-01 (HPM 2026-10-18) — the server completion guard of a power session, end to end on the LOCAL Supabase:
 * the real session-execution Edge Function with the rider's JWT (HTTP status, code, message) and what is persisted.
 *
 * POWER_GUARD_01_EXPECTED = "installed" (default: the migration 20261018120000 is applied) | "absent" (the stack at the
 * 75 production migrations: the reproduction before the fix — a power session completes with no set).
 * Opt-in: RUN_LOCAL_P0_EDGE=1, the runtime served (`supabase functions serve`).
 *
 *  1. zero set → refused (installed: 422 strength_set_required, nothing written; absent: 200, the defect)
 *  2. one valid set out of many → completed (a partial session stays legitimate)
 *  3. every set → completed
 *  4. only invalidated results (a done set corrected to not done; a warm-up set; not-done sets) → refused
 *  5. a blocking health signal → 409 health_suspended first, whatever the sets
 *  6. idempotent replay of the completion → 200 unchanged; a second completion → 409 invalid_transition
 *  7. Force and DH unchanged (strength_set_required / dh_pass_required; one set / pass → completed); mobility completes
 *     with no result (by design)
 *  8. power off: a manual power session gets no document; power on: it gets one and the guard applies
 *  9. a power session of a plan generated with power on, served after power is off → the guard applies
 *  +  no bypass: the RPC called directly (service role) gives the same refusal; the rider cannot write an event directly.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertHealthFlag, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";

const EXPECTED = process.env.POWER_GUARD_01_EXPECTED ?? "installed";
const INSTALLED = EXPECTED === "installed";
const ENABLED = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1" && (EXPECTED === "installed" || EXPECTED === "absent");
const OFF = DEFAULT_RUN_DAILY_FOR_DEPS;
const POWER_ON = { ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches: { power: true, mobility: true } };

type Item = { kind: string; prescriptionItemId: string; exerciseId?: string; sets?: number; measure: { type: string; min?: number; max?: number; count?: number } };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[] };
type Final = { id: string; structure: Structure };

async function assertServing(fn: string) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${resolveTestSupabaseUrl()}/functions/v1/${fn}`, { method: "OPTIONS" });
      if (res.status === 200 || res.status === 204) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Local Edge runtime is not serving ${fn}. Start it: \`npx supabase functions serve\`.`);
}

async function invoke(client: SupabaseClient, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const { data, error } = await client.functions.invoke("session-execution", { body: body as Record<string, unknown> });
  if (!error) return { status: 200, body: data as Record<string, any> };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }
  throw error;
}

const work = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items).filter((i) => i.kind === "exercise");
const warmUp = (s: Structure) => s.blocks.filter((b) => b.role === "warm_up").flatMap((b) => b.items).filter((i) => i.kind === "exercise");

describe.skipIf(!ENABLED)(`POWER-GUARD-01 — power completion guard over HTTP (local Edge runtime, guard ${EXPECTED})`, { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let client: SupabaseClient;
  let sessions: { date: string; kind: string }[];

  beforeAll(async () => {
    await assertServing("session-execution");
    admin = createTestClient();
    ({ athleteId } = await createTestAthlete(admin, `POWER-GUARD-01 ${randomUUID().slice(0, 6)}`));
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    // A plan generated with the power option ON (its power days persist whatever the secret later says).
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", powerSessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data } = await admin.from("training_plan_generated_sessions").select("date, kind").eq("plan_version_id", persisted.planVersionId).order("date");
    sessions = (data ?? []) as { date: string; kind: string }[];
    client = await getAthleteAuthClient(athleteId);
  });

  const finalOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", decisionId).maybeSingle();
    return data as Final | null;
  };
  /** A manual session of `date` (the rider's own, over what was planned). */
  async function manual(date: string, intervention: Record<string, unknown>, sessionType: string) {
    const { error } = await client
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: date, session_type: sessionType, intervention, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
  }
  /** The day's document through the Node daily run (the switches given), then an execution started over HTTP. */
  async function startDay(date: string, deps = OFF) {
    await insertCheckin(admin, athleteId, date);
    const run = await runDailyFor(admin, athleteId, date, deps);
    const f = await finalOf(run.persistence.decision_id);
    if (!f) throw new Error(`no document on ${date}: ${run.finalPrescriptionStatus}`);
    const exec = randomUUID();
    const start = await invoke(client, { execution: { id: exec, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: f.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${date}T17:00:00Z` }] });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    return { f, exec, date };
  }
  const set = (exec: string, item: Item, n: number, over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    execution_id: exec,
    prescription_item_id: item.prescriptionItemId,
    set_number: n,
    done: true,
    measure_type: item.measure.type,
    measure_value: item.measure.type === "pass" ? null : (item.measure.max ?? item.measure.min ?? 5),
    occurred_at: `2026-10-01T17:${String(10 + n).padStart(2, "0")}:00Z`,
    ...over,
  });
  const completed = (exec: string, date: string) => ({ id: randomUUID(), execution_id: exec, event_type: "completed", occurred_at: `${date}T18:00:00Z` });
  const isCompleted = async (exec: string) => {
    const { data } = await admin.from("execution_events").select("event_type").eq("execution_id", exec);
    return (data ?? []).some((e) => e.event_type === "completed");
  };
  const setCount = async (exec: string) => (await admin.from("exercise_set_results").select("id").eq("execution_id", exec)).data!.length;
  const refusedNoSet = (r: { status: number; body: Record<string, any> }) =>
    INSTALLED ? expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([422, "strength_set_required", "Record at least one performed work set before completing this session."]) : expect(r.status).toBe(200);

  const powerDays = () => sessions.filter((s) => s.kind === "POWER").map((s) => s.date);
  const free = () => {
    // Days of the plan used here, in order: never twice (one main session per day).
    const used = new Set(usedDays);
    const day = sessions.map((s) => s.date).find((d) => !used.has(d) && !powerDays().includes(d))!;
    usedDays.push(day);
    return day;
  };
  const usedDays: string[] = [];

  it("8 — power off: a manual power session gets no document (refused as before PHYS); power on: the catalogue power session", async () => {
    const day = free();
    await manual(day, { kind: "POWER", load_profile: "MODERATE" }, "STRENGTH_B");
    await insertCheckin(admin, athleteId, day);
    const off = await runDailyFor(admin, athleteId, day, OFF);
    expect([off.finalPrescriptionStatus, await finalOf(off.persistence.decision_id)]).toEqual(["blocked", null]);
    const on = await runDailyFor(admin, athleteId, day, POWER_ON);
    expect([on.finalPrescriptionStatus, (await finalOf(on.persistence.decision_id))?.structure.family]).toEqual(["created", "power"]);
  });

  it("1 + 2 — zero set: refused, nothing written; then one valid work set out of many: completed (partial)", async () => {
    const day = free();
    await manual(day, { kind: "POWER", load_profile: "MODERATE" }, "STRENGTH_B");
    const { f, exec } = await startDay(day, POWER_ON);
    expect(f.structure.family).toBe("power");
    const total = work(f.structure).reduce((n, i) => n + (i.sets ?? 1), 0);
    expect(total).toBeGreaterThan(1);
    const zero = await invoke(client, { events: [completed(exec, day)] });
    refusedNoSet(zero);
    if (!INSTALLED) return; // the defect reproduced: completed with no set
    expect([await isCompleted(exec), await setCount(exec)]).toEqual([false, 0]);
    const one = await invoke(client, { sets: [set(exec, work(f.structure)[0]!, 1)], events: [completed(exec, day)] });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect([await isCompleted(exec), await setCount(exec)]).toEqual([true, 1]);
  });

  it("3 + 6 — every set: completed; an identical replay → 200 unchanged; a second completion → 409 invalid_transition", async () => {
    const day = free();
    await manual(day, { kind: "POWER", load_profile: "MODERATE" }, "STRENGTH_B");
    const { f, exec } = await startDay(day, POWER_ON);
    const sets = work(f.structure).flatMap((item) => Array.from({ length: item.sets ?? 1 }, (_, i) => set(exec, item, i + 1)));
    const batch = { sets, events: [completed(exec, day)] };
    const done = await invoke(client, batch);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const replay = await invoke(client, batch);
    expect([replay.status, replay.body.inserted?.events, replay.body.unchanged?.events?.length]).toEqual([200, [], 1]);
    const again = await invoke(client, { events: [completed(exec, day)] });
    expect([again.status, again.body.error?.code]).toEqual([409, "invalid_transition"]);
    expect(await setCount(exec)).toBe(sets.length);
  });

  it("4 — only invalidated results (a set corrected to not done, a warm-up set, a not-done set): refused", async () => {
    const day = free();
    await manual(day, { kind: "POWER", load_profile: "MODERATE" }, "STRENGTH_B");
    const { f, exec } = await startDay(day, POWER_ON);
    const [first, second] = work(f.structure);
    const original = set(exec, first!, 1);
    expect((await invoke(client, { sets: [original] })).status).toBe(200);
    const correction = set(exec, first!, 1, { done: false, measure_value: null, supersedes_id: original.id });
    expect((await invoke(client, { sets: [correction] })).status).toBe(200);
    refusedNoSet(await invoke(client, { events: [completed(exec, day)] }));
    if (!INSTALLED) return;
    // A warm-up exercise and a not-done work set do not count either.
    expect((await invoke(client, { sets: [set(exec, warmUp(f.structure)[0]!, 1), set(exec, second!, 1, { done: false, measure_value: null })] })).status).toBe(200);
    refusedNoSet(await invoke(client, { events: [completed(exec, day)] }));
    expect([await isCompleted(exec), await setCount(exec)]).toEqual([false, 4]);
  });

  it("9 — a power session of the plan generated with power on, served with power off: the guard applies", async () => {
    const day = powerDays()[0]!;
    usedDays.push(day);
    const { f, exec } = await startDay(day, OFF);
    expect(f.structure.family).toBe("power");
    refusedNoSet(await invoke(client, { events: [completed(exec, day)] }));
    if (!INSTALLED) return;
    const one = await invoke(client, { sets: [set(exec, work(f.structure)[0]!, 1)], events: [completed(exec, day)] });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
  });

  it("no bypass — the RPC called directly gives the same refusal; the rider cannot write an event directly", async () => {
    const day = free();
    await manual(day, { kind: "POWER", load_profile: "MODERATE" }, "STRENGTH_B");
    const { exec } = await startDay(day, POWER_ON);
    const { data } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: { events: [completed(exec, day)] } });
    expect(data).toMatchObject(INSTALLED ? { status: "rejected", code: "strength_set_required" } : { status: "ok" });
    const direct = await client.from("execution_events").insert({ id: randomUUID(), execution_id: exec, athlete_id: athleteId, event_type: "completed", occurred_at: `${day}T18:00:00Z` });
    expect(direct.error).not.toBeNull();
    expect(await isCompleted(exec)).toBe(!INSTALLED);
  });

  it("7 — Force and DH unchanged; a mobility session completes with no result (by design)", async () => {
    // Force: zero set → strength_set_required; one set → completed.
    const forceDay = sessions.find((s) => (s.kind === "STRENGTH_LOWER" || s.kind === "STRENGTH_UPPER") && !usedDays.includes(s.date))!.date;
    usedDays.push(forceDay);
    const force = await startDay(forceDay, OFF);
    expect(force.f.structure.family).toBe("strength");
    const fz = await invoke(client, { events: [completed(force.exec, forceDay)] });
    expect([fz.status, fz.body.error?.code]).toEqual([422, "strength_set_required"]);
    expect((await invoke(client, { sets: [set(force.exec, work(force.f.structure)[0]!, 1)], events: [completed(force.exec, forceDay)] })).status).toBe(200);
    // DH: zero pass → dh_pass_required; one pass → completed.
    const dhDay = sessions.find((s) => s.kind === "DH_TECHNICAL" && !usedDays.includes(s.date))!.date;
    usedDays.push(dhDay);
    const dh = await startDay(dhDay, OFF);
    expect(dh.f.structure.family).toBe("dh_technical");
    const dz = await invoke(client, { events: [completed(dh.exec, dhDay)] });
    expect([dz.status, dz.body.error?.code]).toEqual([422, "dh_pass_required"]);
    const drill = dh.f.structure.blocks.find((b) => b.role === "main")!.items[0]!;
    expect((await invoke(client, { sets: [{ ...set(dh.exec, drill, 1), measure_type: "pass", measure_value: null, success: true }], events: [completed(dh.exec, dhDay)] })).status).toBe(200);
    // Mobility (family mobility): no result required.
    const mobilityDay = free();
    await manual(mobilityDay, { kind: "MOBILITY" }, "RECOVERY");
    const mob = await startDay(mobilityDay, POWER_ON);
    expect(mob.f.structure.family).toBe("mobility");
    expect((await invoke(client, { events: [completed(mob.exec, mobilityDay)] })).status).toBe(200);
  });

  it("5 — a blocking health signal: 409 health_suspended first, never the set refusal (another rider: the signal blocks every action)", async () => {
    const { athleteId: other } = await createTestAthlete(admin, `POWER-GUARD-01 health ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, other, "Downhill");
    await upsertPerformanceProfileFor(admin, other, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, other, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId: other, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", powerSessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, other, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", persisted.planVersionId).eq("kind", "POWER").order("date");
    const day = (data as { date: string }[])[0]!.date;
    await insertCheckin(admin, other, day);
    const run = await runDailyFor(admin, other, day, OFF);
    const f = (await finalOf(run.persistence.decision_id))!;
    const otherClient = await getAthleteAuthClient(other);
    const exec = randomUUID();
    expect((await invoke(otherClient, { execution: { id: exec, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: f.id, comment: null }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${day}T17:00:00Z` }] })).status).toBe(200);
    // The signal opens after the start (e.g. a pain reported mid-session).
    await insertHealthFlag(admin, other, "injury_suspect", "active");
    const zero = await invoke(otherClient, { events: [completed(exec, day)] });
    expect([zero.status, zero.body.error?.code]).toEqual([409, "health_suspended"]);
    const withSet = await invoke(otherClient, { sets: [set(exec, work(f.structure)[0]!, 1)], events: [completed(exec, day)] });
    expect([withSet.status, withSet.body.error?.code]).toEqual([409, "health_suspended"]);
    // The safe closure stays allowed.
    expect((await invoke(otherClient, { events: [{ id: randomUUID(), execution_id: exec, event_type: "abandoned", occurred_at: `${day}T18:05:00Z` }] })).status).toBe(200);
  });
});

// Fingerprint: the installed function is the migration's body, the rollback script restores 20261013160000's body
// exactly, and the two differ only by the power condition (and its comment).
// V2-DH-REVOCATION (PR2-DH-REVOCATION-PREP, HPM 2026-10-27) — migration 20261027120000 redefines this function (and
// persist_daily_run_v2): the installed body is now that migration's. Not a mere new fingerprint: what it must keep
// (POWER-GUARD-01's body, verbatim) and add (exactly the revocation guard) is asserted on the files everywhere (no
// database), then its installed body and its behaviour on the local stack.

const sqlBody = (path: string, fn: string, tag: string) => {
  const text = readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(`as ${tag}`, text.indexOf(`create or replace function public.${fn}`)) + `as ${tag}`.length;
  return text.slice(start, text.indexOf(`${tag};`, start));
};
const norm = (s: string) => s.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").split("\n").map((l) => l.trimEnd()).join("\n");
const MIGRATION = "../../../supabase/migrations/20261018120000_power_guard_01_power_set_required.sql";
const REVOCATION = "../../../supabase/migrations/20261027120000_v2_dh_drill_revocation.sql";

// The revocation insertions of migration 20261027120000, verbatim.
const RC_GUARD = [
  "  -- V2-DH-REVOCATION — READ COMMITTED only: the SHARE lock below orders this call after a revocation",
  "  -- being written, and only a fresh snapshot per statement then sees it (a snapshot taken when the call began, as",
  "  -- in REPEATABLE READ or SERIALIZABLE, would miss it). Checked first, before any lock or write.",
  "  if current_setting('transaction_isolation') <> 'read committed' then",
  "    raise exception using errcode = 'NX301', message = 'dh_revocation_requires_read_committed';",
  "  end if;",
  "",
].join("\n");
const REVOCATION_LOCK = [
  "  -- V2-DH-REVOCATION — serialised with a safety revocation: a revocation being written is waited for,",
  "  -- then seen by every check below; a revocation written after this point waits until this batch is committed.",
  "  lock table public.dh_drill_revocations in share mode;",
  "",
].join("\n");
const revocationCheck = (indent: number, finalPrescription: string) =>
  [
    "-- V2-DH-REVOCATION — a DH drill revoked for safety: no new training action on it.",
    `if public.execution_dh_revocation_block(${finalPrescription}) is not null then`,
    "  raise exception using errcode = 'NX001', message = 'dh_validation_not_current', detail = v_target;",
    "end if;",
  ]
    .map((l) => " ".repeat(indent) + l)
    .join("\n") + "\n";
const CHECK_START = revocationCheck(8, "v_exec_fp_id");
const CHECK_EVENT = revocationCheck(8, "(select e.final_prescription_id from public.session_executions e where e.id = v_ev_exec_id)");
const CHECK_RESULT = revocationCheck(6, "v_exec_row.final_prescription_id"); // sets, then activities

describe("V2-DH-REVOCATION (migration 20261027120000) — record_session_execution keeps every POWER-GUARD-01 protection and adds exactly the revocation guard (files)", () => {
  const migration = sqlBody(MIGRATION, "record_session_execution", "$$");
  const revocation = sqlBody(REVOCATION, "record_session_execution", "$$");
  const at = (needle: string, from = 0) => {
    const i = revocation.indexOf(needle, from);
    if (i < 0) throw new Error(`not in migration 20261027120000: ${needle.slice(0, 80)}`);
    return i;
  };

  it("conservation: the migration without its six revocation insertions is the migration's body verbatim (nothing removed or altered)", () => {
    let stripped = revocation;
    for (const [insertion, times] of [[RC_GUARD, 1], [REVOCATION_LOCK, 1], [CHECK_START, 1], [CHECK_EVENT, 1], [CHECK_RESULT, 2]] as const) {
      expect(stripped.split(insertion).length - 1, insertion.slice(0, 60)).toBe(times);
      stripped = stripped.split(insertion).join("");
    }
    expect(norm(stripped)).toBe(norm(migration));
  });

  it("READ COMMITTED guard first, then the revocation lock right after the per-athlete lock, both before the batch is read or written", () => {
    const outerBegin = at("\nbegin\n") + "\nbegin\n".length;
    expect(revocation.slice(outerBegin).startsWith(RC_GUARD)).toBe(true);
    const batch = at("\n  begin\n    if p_payload is null");
    expect(at(REVOCATION_LOCK)).toBeGreaterThan(at("perform pg_advisory_xact_lock("));
    expect(at(REVOCATION_LOCK) + REVOCATION_LOCK.length).toBeLessThanOrEqual(batch + 1);
  });

  it("refusal before write, transactional: the four writes of a batch are each preceded by their revocation check, all inside the NX001 block (a refusal rolls the whole batch back)", () => {
    const batch = at("\n  begin\n    if p_payload is null");
    const handler = at("  exception\n    when sqlstate 'NX001' then");
    expect(revocation.split("insert into public.").length - 1).toBe(4);
    const sections: [string, string, string][] = [
      ["if v_exec is not null then", CHECK_START, "insert into public.session_executions"],
      ["if v_ev_type in ('resumed', 'completed') then", CHECK_EVENT, "insert into public.execution_events"],
      ["from jsonb_array_elements(v_sets) with ordinality loop", CHECK_RESULT, "insert into public.exercise_set_results"],
      ["from jsonb_array_elements(v_activities) with ordinality loop", CHECK_RESULT, "insert into public.session_activity_results"],
    ];
    for (const [section, check, write] of sections) {
      const from = at(section);
      const checkAt = at(check, from);
      const writeAt = at(write, from);
      expect([batch < from, from < checkAt, checkAt < writeAt, writeAt < handler], write).toEqual([true, true, true, true]);
    }
  });

  it("persist_daily_run_v2 likewise: migration 20261027120000 is 20261013180100's body plus the same guard first and the revoked-drill refusal before its first write", () => {
    const current = sqlBody("../../../supabase/migrations/20261013180100_p0_3_manual_keep_persist_daily_run_v2.sql", "persist_daily_run_v2", "$function$");
    const proposed = sqlBody(REVOCATION, "persist_daily_run_v2", "$function$");
    const refusalStart = proposed.indexOf("  -- -------------------------------------------------------------------------\n  -- V2-DH-REVOCATION — a final prescription");
    const refusalEnd = proposed.indexOf("  -- -------------------------------------------------------------------------\n  -- Health flag (same behaviour as persist_daily_run).");
    expect([refusalStart > 0, refusalEnd > refusalStart]).toEqual([true, true]);
    const refusal = proposed.slice(refusalStart, refusalEnd);
    expect(refusal).toContain("lock table public.dh_drill_revocations in share mode;");
    expect(refusal).toContain("raise exception using errcode = 'NX302', message = 'dh_validation_not_current', detail = v_revoked_drills;");
    expect(refusalEnd).toBeLessThan(proposed.indexOf("insert into public."));
    const outerBegin = proposed.indexOf("\nbegin\n") + "\nbegin\n".length;
    expect(proposed.slice(outerBegin).startsWith(RC_GUARD)).toBe(true);
    const stripped = proposed.replace(refusal, "").replace(RC_GUARD, "").replace("\n  -- V2-DH-REVOCATION\n  v_revoked_drills text;\n", "");
    expect(norm(stripped)).toBe(norm(current));
  });
});

describe.skipIf(!localIntegrationRequested() || !INSTALLED)("POWER-GUARD-01 — function fingerprint (local Supabase)", () => {
  const migration = sqlBody(MIGRATION, "record_session_execution", "$$");
  const previous = sqlBody("../../../supabase/migrations/20261013160000_p0_3_health_suspension_execution_guard.sql", "record_session_execution", "$$");
  const rollback = sqlBody("../../../supabase/rollbacks/power-guard-01/20261018120000_rollback_power_guard_01.sql", "record_session_execution", "$$");
  const revocation = sqlBody(REVOCATION, "record_session_execution", "$$");

  it("the installed record_session_execution is migration 20261027120000's body, verbatim (proven above to be POWER-GUARD-01's body plus exactly the revocation guard)", () => {
    const installed = norm(execLocalSql("select prosrc from pg_proc where proname = 'record_session_execution';"));
    expect(installed).toBe(norm(revocation));
  });

  it("the rollback restores 20261013160000 exactly; migration vs previous: only the power condition and its comment", () => {
    expect(norm(rollback)).toBe(norm(previous));
    const before = norm(previous).split("\n");
    const after = norm(migration).split("\n");
    const removed = before.filter((l) => !after.includes(l));
    const added = after.filter((l) => !before.includes(l));
    expect(removed).toEqual(["      if found and v_act_structure ->> 'family' = 'strength'"]);
    expect(added.filter((l) => !l.trimStart().startsWith("--"))).toEqual(["      if found and v_act_structure ->> 'family' in ('strength', 'power')"]);
  });

  it("security: SECURITY DEFINER, search_path, owner and EXECUTE grants unchanged (service_role only)", () => {
    const row = execLocalSql(
      "select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || pg_get_userbyid(p.proowner) || '|' || " +
        "(select string_agg(grantee || ':' || privilege_type, ',' order by grantee) from information_schema.routine_privileges r where r.routine_schema = 'public' and r.routine_name = 'record_session_execution') " +
        "from pg_proc p where p.proname = 'record_session_execution';"
    ).trim();
    expect(row).toBe("true|search_path=public|postgres|postgres:EXECUTE,service_role:EXECUTE");
  });

  it("revocation installed: a refused action rolls its whole batch back (the event written before it in the same batch does not survive); any isolation but READ COMMITTED is refused first", async () => {
    const admin = createTestClient();
    const { athleteId } = await createTestAthlete(admin, `POWER-GUARD-01 revocation ${randomUUID().slice(0, 6)}`);
    const day = "2026-12-20";
    await insertCheckin(admin, athleteId, day);
    const [decision, fp, item, execution] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const drill = `pg01_probe_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const structure = { schemaVersion: "v2", family: "dh_technical", sessionKind: "DH_TECHNICAL", blocks: [{ blockId: "main", role: "main", items: [{ kind: "drill", prescriptionItemId: item, drillId: drill, measure: { type: "pass", count: 4, unit: "SECTION" } }] }] };
    execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at)
  select ${sqlLiteral(decision)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, 'DH_TECHNICAL', 'test fixture', 'test', 'created', c.id, c.updated_at
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fp)}, ${sqlLiteral(decision)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(structure))}::jsonb);`);
    const at = (minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;
    const call = (payload: unknown) => `public.record_session_execution(${sqlLiteral(athleteId)}::uuid, ${sqlLiteral(JSON.stringify(payload))}::jsonb)`;
    const outcome = (payload: unknown) => `select 'batch:' || (r ->> 'status') || coalesce('/' || (r ->> 'code') || '/' || (r ->> 'target'), '') from (select ${call(payload)} as r) s;`;
    expect(execLocalSql(outcome({ execution: { id: execution, session_date: day, started_at: at(0), final_prescription_id: fp }, events: [{ id: randomUUID(), execution_id: execution, event_type: "started", occurred_at: at(0) }] })).trim()).toBe("batch:ok");

    // One batch: a `paused` event (allowed, written first), then a pass result (a new training action).
    const batch = {
      events: [{ id: randomUUID(), execution_id: execution, event_type: "paused", occurred_at: at(10) }],
      sets: [{ id: randomUUID(), execution_id: execution, prescription_item_id: item, set_number: 1, done: true, measure_type: "pass", measure_value: null, success: true, occurred_at: at(11) }],
    };
    const probe = (revoked: boolean) =>
      execLocalSql(`begin;
${revoked ? `insert into public.dh_drill_revocations (drill_id, reason, decided_by) values (${sqlLiteral(drill)}, 'TEST fixture: safety revocation (not a sports decision)', 'TEST operator');` : ""}
${outcome(batch)}
select 'events:' || count(*) from public.execution_events where execution_id = ${sqlLiteral(execution)};
select 'sets:' || count(*) from public.exercise_set_results where execution_id = ${sqlLiteral(execution)};
rollback;`)
        .split("\n")
        .filter((l) => /^(batch|events|sets):/.test(l));
    // Control (no revocation): the batch is written. Revoked: refused at the result, and the event before it is gone too.
    expect(probe(false)).toEqual(["batch:ok", "events:2", "sets:1"]);
    expect(probe(true)).toEqual(["batch:rejected/dh_validation_not_current/sets[0]", "events:1", "sets:0"]);
    for (const level of ["repeatable read", "serializable"]) {
      expect(() => execLocalSql(`\\set VERBOSITY verbose\nbegin isolation level ${level};\nselect ${call(batch)};\nrollback;`), level).toThrow(/NX301: dh_revocation_requires_read_committed/);
    }
    // Nothing left behind: no revocation, the execution only started.
    expect(execLocalSql(`select (select count(*) from public.dh_drill_revocations where drill_id = ${sqlLiteral(drill)}) || '|' || (select count(*) from public.execution_events where execution_id = ${sqlLiteral(execution)});`).trim()).toBe("0|1");
  });
});
