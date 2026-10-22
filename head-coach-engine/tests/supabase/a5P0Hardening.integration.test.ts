/**
 * SPORT-SAFE-02 A5-P0 (HPM 2026-10-21) — LOCAL proof of the concussion hardening: migration
 * 20261021200000_sport_safe_02_a5_p0_hardening.sql applied to the local stack, the runtime served from this branch.
 * Opt-in: RUN_LOCAL_SUPABASE_INTEGRATION=1, RUN_LOCAL_P0_EDGE=1.
 *
 * - Execution: an open concussion signal refuses a start, a resume, every result and a completion for EVERY family,
 *   read on the signal itself (no new daily run needed); a prescription computed before the last change of the
 *   signal is never startable again (closure included).
 * - Lifecycle: the rider's declarative attestation (never verified by NALYNT) is the only way to change or close a
 *   concussion signal; a service role, another rider or a direct write cannot.
 * Counter-proof: with the rollback applied, the « every family », « stale prescription » and « unauthorised closure »
 * cases fail (see the A5-P0 implementation gate).
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, insertRace, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localDbContainer, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays } from "../../src/supabase/productCalendar.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";
type Body = Record<string, unknown>;
type Item = { prescriptionItemId: string; measure: { type: string } };
type Prescription = { id: string; structure: { family: string; blocks: { role: string; items: Item[] }[] } };
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe.skipIf(!EDGE)("SPORT-SAFE-02 A5-P0 — concussion hardening (local stack, local Edge)", { timeout: 600_000 }, () => {
  let admin: SupabaseClient;
  const report: Record<string, unknown> = {};
  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
    const installed = execLocalSql(`select to_regclass('public.health_flag_attestations') is not null;`).trim();
    if (installed !== "t") throw new Error("A5-P0 migration not applied to the local stack");
  });
  afterAll(() => {
    if (process.env.A5P0_REPORT) writeFileSync(process.env.A5P0_REPORT, JSON.stringify(report, null, 2));
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
  const code = (r: { status: number; body: Body }) => (r.status === 200 ? "ok" : `${r.status} ${(r.body.error as { code?: string } | undefined)?.code ?? "?"}`);

  /** A V2 rider with an accepted plan: days by family. */
  async function planRider(label: string) {
    const { athleteId } = await createTestAthlete(admin, `A5-P0 ${label} ${randomUUID().slice(0, 6)}`);
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
    const daysOf = (prefix: string) => rows.filter((x) => x.intervention?.kind.startsWith(prefix)).map((x) => x.planned_date);
    return { athleteId, client: await getAthleteAuthClient(athleteId), force: daysOf("STRENGTH"), dh: daysOf("DH_"), endurance: daysOf("AEROBIC") };
  }
  type Rider = { athleteId: string; client: SupabaseClient };

  async function ready(r: Rider, day: string): Promise<Prescription> {
    await insertCheckin(admin, r.athleteId, day);
    const run = await invoke(r.client, "daily-run", { date: day });
    if (run.body.finalPrescriptionStatus !== "created") throw new Error(`no prescription on ${day}: ${JSON.stringify(run.body.finalPrescriptionStatus)}`);
    return run.body.finalPrescription as Prescription;
  }
  async function rerun(r: Rider, day: string) {
    const run = await invoke(r.client, "daily-run", { date: day });
    const plan = run.body.dailyPlan as { decision: string; triggered_rules: { rule_id: string; layer: string }[]; final_session: { kind: string } };
    return { decision: plan.decision, rules: plan.triggered_rules.filter((x) => x.layer === "A").map((x) => x.rule_id), kind: plan.final_session.kind, prescription: run.body.finalPrescription as Prescription | undefined };
  }
  function session(r: Rider, day: string, fp: Prescription) {
    const id = randomUUID();
    const main = fp.structure.blocks.find((b) => b.role === "main")!.items[0]!;
    let n = 0;
    const startBatch = {
      execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fp.id },
      events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }],
    };
    return {
      id,
      startBatch,
      start: () => invoke(r.client, "session-execution", startBatch).then(code),
      ev: (event_type: string) => invoke(r.client, "session-execution", { events: [{ id: randomUUID(), execution_id: id, event_type, occurred_at: `${day}T17:${String(30 + (n += 1)).padStart(2, "0")}:00Z` }] }).then(code),
      result: (setNumber: number, supersedes: string | null = null) =>
        invoke(r.client, "session-execution", {
          sets: [{ id: randomUUID(), execution_id: id, prescription_item_id: main.prescriptionItemId, set_number: setNumber, done: true, measure_type: main.measure.type, measure_value: main.measure.type === "pass" ? null : 8, supersedes_id: supersedes, occurred_at: `${day}T17:${String(10 + setNumber).padStart(2, "0")}:00Z` }],
        }),
    };
  }
  const openConcussion = (athleteId: string, flagDate: string) =>
    execLocalSql(`insert into public.health_flags (athlete_id, flag_date, flag_type, status, description) values (${lit(athleteId)}, ${lit(flagDate)}, 'concussion_suspect', 'active', 'Suspicion de commotion déclarée au checkin') returning id;`).trim().split("\n")[0]!.trim();
  const flagRow = (flagId: string) => execLocalSql(`select status || '|' || coalesce(resolution_note, '-') from public.health_flags where id = ${lit(flagId)};`).trim();
  async function attest(client: SupabaseClient, body: Record<string, unknown>) {
    const { data, error } = await client.rpc("record_health_flag_attestation", { p_attestation: body });
    if (error) return { status: "error", code: error.code ?? error.message };
    return data as { status: string; code?: string; flag_status?: string };
  }
  async function plainRider(label: string) {
    const { athleteId } = await createTestAthlete(admin, `A5-P0 ${label} ${randomUUID().slice(0, 6)}`);
    return { athleteId, client: await getAthleteAuthClient(athleteId) };
  }

  it("every family: a prescription ready BEFORE the signal cannot be started once a concussion signal is open (no new daily run)", async () => {
    const r = await planRider("families");
    const days = { strength: r.force[0]!, dh_technical: r.dh[0]!, endurance: r.endurance[0]! };
    const fps = { strength: await ready(r, days.strength), dh_technical: await ready(r, days.dh_technical), endurance: await ready(r, days.endurance) };
    openConcussion(r.athleteId, addCalendarDays(days.strength, -1) < addCalendarDays(days.dh_technical, -1) ? addCalendarDays(days.strength, -1) : addCalendarDays(days.dh_technical, -1));
    const out: Record<string, string> = {};
    for (const family of ["strength", "dh_technical", "endurance"] as const) {
      expect(fps[family].structure.family).toBe(family);
      out[family] = await session(r, days[family], fps[family]).start();
    }
    report.everyFamily = out;
    expect(out).toEqual({ strength: "409 health_suspended", dh_technical: "409 health_suspended", endurance: "409 health_suspended" });
  });

  it("attempts already begun (Force and DH): result, correction, resume and completion refused; pause and abandon accepted; recorded results kept", async () => {
    const r = await planRider("attempts");
    const out: Record<string, unknown> = {};
    for (const [label, day] of [["strength", r.force[0]!], ["dh", r.dh[0]!]] as const) {
      const s = session(r, day, await ready(r, day));
      expect(await s.start()).toBe("ok");
      const first = await s.result(1);
      expect(code(first)).toBe("ok");
      const firstId = ((first.body as { sets?: { inserted?: string[] } }).sets?.inserted ?? [])[0] ?? null;
      void firstId;
      openConcussion(r.athleteId, addCalendarDays(day, -1));
      const row = {
        result: code(await s.result(2)),
        pause: await s.ev("paused"),
        resume: await s.ev("resumed"),
        completion: await s.ev("completed"),
        abandon: await s.ev("abandoned"),
        kept: execLocalSql(`select count(*) from public.exercise_set_results where execution_id = ${lit(s.id)};`).trim(),
      };
      out[label] = row;
      // The next family runs on its own signal-free start: close this one through the rider's attestation.
      const flagId = execLocalSql(`select id from public.health_flags where athlete_id = ${lit(r.athleteId)} and flag_type = 'concussion_suspect' and status <> 'resolved';`).trim();
      expect((await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "ruled_out", assessed_on: day > TODAY ? TODAY : addCalendarDays(day, 0) })).status).toBe("recorded");
    }
    report.attempts = out;
    for (const row of Object.values(out)) expect(row).toEqual({ result: "409 health_suspended", pause: "ok", resume: "409 health_suspended", completion: "409 health_suspended", abandon: "ok", kept: "1" });
  });

  it("concurrency: a signal opened while a start is sent — never a start accepted AND a result after the signal; the lock serialises both", async () => {
    const r = await planRider("concurrency");
    const outcomes: string[] = [];
    for (const day of r.force.slice(0, 3)) {
      const fp = await ready(r, day);
      const s = session(r, day, fp);
      const [started] = await Promise.all([
        s.start(),
        admin.from("health_flags").insert({ athlete_id: r.athleteId, flag_date: addCalendarDays(day, -1), flag_type: "concussion_suspect", status: "active", description: "Suspicion de commotion déclarée au checkin" }),
      ]);
      const after = code(await s.result(1));
      outcomes.push(`${started} → result ${after}`);
      expect(after).not.toBe("ok");
      const flagId = execLocalSql(`select id from public.health_flags where athlete_id = ${lit(r.athleteId)} and flag_type = 'concussion_suspect' and status <> 'resolved';`).trim();
      expect((await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "ruled_out", assessed_on: day })).status).toBe("recorded");
    }
    report.concurrency = outcomes;
  });

  it("serialisation: a start sent while another transaction is opening the signal WAITS for it, then is refused (no interleaving)", async () => {
    const r = await planRider("lock");
    const day = r.force[0]!;
    const s = session(r, day, await ready(r, day));
    // An opening transaction that holds the athlete's lock (taken by the health_flags trigger) for 3 seconds.
    const sql = `begin; insert into public.health_flags (athlete_id, flag_date, flag_type, status, description) values (${lit(r.athleteId)}, ${lit(addCalendarDays(day, -1))}, 'concussion_suspect', 'active', 'Suspicion de commotion déclarée au checkin'); select pg_sleep(3); commit;`;
    const opening = new Promise<number>((resolve) => {
      const p = spawn("docker", ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql]);
      p.on("close", (c) => resolve(c ?? -1));
    });
    await new Promise((res) => setTimeout(res, 800));
    const t0 = Date.now();
    const started = await s.start();
    const waitedMs = Date.now() - t0;
    const exit = await opening;
    report.serialisation = { started, waitedMs, openingExit: exit };
    expect([started, exit]).toEqual(["409 health_suspended", 0]);
    expect(waitedMs).toBeGreaterThan(1500);
  });

  it("two signals and closure between calls: injury + concussion suspend; the injury closed, the concussion still suspends; once the concussion is closed the OLD prescription is never reactivated — a new daily run gives a new one", async () => {
    const r = await planRider("closure");
    const day = r.force[0]!;
    const old = await ready(r, day);
    const flagId = openConcussion(r.athleteId, addCalendarDays(day, -1));
    execLocalSql(`insert into public.health_flags (athlete_id, flag_date, flag_type, status, description) values (${lit(r.athleteId)}, ${lit(addCalendarDays(day, -1))}, 'injury_suspect', 'active', 'Douleur sévère déclarée (7/10) — knee_R');`);
    const both = await session(r, day, old).start();
    execLocalSql(`update public.health_flags set status = 'resolved', resolved_at = ${lit(day)} where athlete_id = ${lit(r.athleteId)} and flag_type = 'injury_suspect';`);
    const concussionOnly = await session(r, day, old).start();
    const closed = await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "full_return_authorised", assessed_on: day, professional_category: "sports_physician" });
    const oldAfterClosure = await session(r, day, old).start();
    const again = await rerun(r, day);
    const oldAfterRerun = await session(r, day, old).start();
    const fresh = again.prescription ? await session(r, day, again.prescription).start() : "no prescription";
    const out = { both, concussionOnly, closed: [closed.status, closed.flag_status], oldAfterClosure, rerun: [again.decision, again.rules], newPrescription: again.prescription?.id !== old.id, oldAfterRerun, fresh, flag: flagRow(flagId) };
    report.closure = out;
    expect(out).toEqual({
      both: "409 health_suspended",
      concussionOnly: "409 health_suspended",
      closed: ["recorded", "resolved"],
      oldAfterClosure: "409 daily_decision_not_current",
      rerun: ["KEEP", []],
      newPrescription: true,
      oldAfterRerun: "409 final_prescription_not_current",
      fresh: "ok",
      flag: "resolved|attestation:full_return_authorised (déclaratif, non vérifié par NALYNT)",
    });
  });

  it("the daily decision under the signal: REST A5 for every family and a race day; historical decisions untouched", async () => {
    const r = await planRider("decision");
    const day = r.dh[0]!;
    const before = execLocalSql(`select count(*) from public.decisions where athlete_id = ${lit(r.athleteId)};`).trim();
    await ready(r, day);
    openConcussion(r.athleteId, addCalendarDays(day, -1));
    const d = await rerun(r, day);
    const decisions = execLocalSql(`select string_agg(daily_plan ->> 'decision', ',' order by created_at) from public.decisions where athlete_id = ${lit(r.athleteId)} and decision_date = ${lit(day)};`).trim();
    report.decision = { d: [d.decision, d.rules, d.prescription === undefined], decisions, before };
    expect([d.decision, d.rules, d.prescription === undefined]).toEqual(["REST", ["A5"], true]);
    expect(decisions).toBe("KEEP,REST");
  });

  it("unauthorised closure is refused: service role, another rider, a direct update, a direct delete, the rider's own table write", async () => {
    const owner = await plainRider("owner");
    const other = await plainRider("other");
    const flagId = openConcussion(owner.athleteId, TODAY);
    const serviceRole = await attest(admin, { id: randomUUID(), flag_id: flagId, outcome: "ruled_out", assessed_on: TODAY });
    const otherRider = await attest(other.client, { id: randomUUID(), flag_id: flagId, outcome: "ruled_out", assessed_on: TODAY });
    const directUpdate = await admin.from("health_flags").update({ status: "resolved", resolved_at: TODAY }).eq("id", flagId);
    const directDelete = await admin.from("health_flags").delete().eq("id", flagId);
    const riderInsert = await owner.client.from("health_flag_attestations").insert({ id: randomUUID(), flag_id: flagId, athlete_id: owner.athleteId, outcome: "ruled_out", assessed_on: TODAY, attested_by: randomUUID() });
    const serviceInsert = await admin.from("health_flag_attestations").insert({ id: randomUUID(), flag_id: flagId, athlete_id: owner.athleteId, outcome: "ruled_out", assessed_on: TODAY, attested_by: randomUUID() });
    const out = {
      serviceRole: serviceRole.status === "error" ? "refused" : `${serviceRole.status} ${serviceRole.code ?? ""}`.trim(),
      otherRider: `${otherRider.status} ${otherRider.code}`,
      directUpdate: directUpdate.error?.message ?? "accepted",
      directDelete: directDelete.error?.message ?? "accepted",
      riderInsert: riderInsert.error ? "refused" : "accepted",
      serviceInsert: serviceInsert.error ? "refused" : "accepted",
      flag: flagRow(flagId),
    };
    report.unauthorised = out;
    expect(out).toEqual({
      serviceRole: "refused",
      otherRider: "rejected flag_not_found",
      directUpdate: "concussion_resolution_requires_attestation",
      directDelete: "concussion_flag_delete_refused",
      riderInsert: "refused",
      serviceInsert: "refused",
      flag: "active|-",
    });
  });

  it("lifecycle: in progress → confirmed (still suspended) → « ruled out » refused after a confirmation → full return authorised; declarative rows, never verified; isolation between riders", async () => {
    const r = await planRider("lifecycle");
    const day = r.force[0]!;
    const fp = await ready(r, day);
    const flagId = openConcussion(r.athleteId, addCalendarDays(day, -1));
    const steps: Record<string, unknown> = {};
    steps.inProgress = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "assessment_in_progress" })).flag_status;
    steps.startInProgress = await session(r, day, fp).start();
    steps.missingDate = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "concussion_confirmed" })).code;
    steps.dateBeforeSignal = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "concussion_confirmed", assessed_on: addCalendarDays(day, -10) })).code;
    steps.confirmed = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "concussion_confirmed", assessed_on: day, professional_category: "physician" })).flag_status;
    steps.startConfirmed = await session(r, day, fp).start();
    steps.ruledOutAfterConfirmed = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "ruled_out", assessed_on: day })).code;
    steps.errorAfterAssessment = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "entered_in_error", entered_in_error_confirmation: true })).code;
    steps.fullReturn = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "full_return_authorised", assessed_on: day })).flag_status;
    steps.afterClosure = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "assessment_in_progress" })).code;
    steps.rows = execLocalSql(`select string_agg(outcome || ':' || declarative || ':' || verified_by_nalynt, ',' order by recorded_at) from public.health_flag_attestations where flag_id = ${lit(flagId)};`).trim();
    const stranger = await plainRider("stranger");
    const { data: seen } = await stranger.client.from("health_flag_attestations").select("id").eq("flag_id", flagId);
    const { data: own } = await r.client.from("health_flag_attestations").select("id").eq("flag_id", flagId);
    steps.isolation = [seen?.length ?? -1, own?.length ?? -1];
    report.lifecycle = steps;
    expect(steps).toEqual({
      inProgress: "monitoring",
      startInProgress: "409 health_suspended",
      missingDate: "assessed_on_required",
      dateBeforeSignal: "assessed_on_out_of_range",
      confirmed: "monitoring",
      startConfirmed: "409 health_suspended",
      ruledOutAfterConfirmed: "invalid_transition",
      errorAfterAssessment: "entered_in_error_after_assessment",
      fullReturn: "resolved",
      afterClosure: "flag_not_open",
      rows: "assessment_in_progress:true:false,concussion_confirmed:true:false,full_return_authorised:true:false",
      isolation: [0, 3],
    });
  });

  it("entry error (HPM 2026-10-22, no « same day » limit): an explicit confirmation, before any assessment, no session recorded since the signal (server timestamps)", async () => {
    const out: Record<string, unknown> = {};
    const a = await plainRider("error-ok");
    const fa = openConcussion(a.athleteId, TODAY);
    out.noConfirmation = (await attest(a.client, { id: randomUUID(), flag_id: fa, outcome: "entered_in_error" })).code;
    out.withProfessional = (await attest(a.client, { id: randomUUID(), flag_id: fa, outcome: "entered_in_error", entered_in_error_confirmation: true, professional_category: "physician" })).code;
    out.sameDay = (await attest(a.client, { id: randomUUID(), flag_id: fa, outcome: "entered_in_error", entered_in_error_confirmation: true })).flag_status;
    out.note = flagRow(fa);
    const b = await plainRider("error-later");
    const fb = openConcussion(b.athleteId, addCalendarDays(TODAY, -3));
    out.daysLater = (await attest(b.client, { id: randomUUID(), flag_id: fb, outcome: "entered_in_error", entered_in_error_confirmation: true })).flag_status;
    const c = await plainRider("error-trained");
    const fc = openConcussion(c.athleteId, TODAY);
    // A session recorded after the declaration (written directly: the server guard refuses it through the RPC),
    // dated the day before: the server timestamp decides, never the session date.
    execLocalSql(`insert into public.completed_sessions (athlete_id, session_date, session_type, completion_status, actual_duration_min) values (${lit(c.athleteId)}, ${lit(addCalendarDays(TODAY, -1))}, 'STRENGTH_A', 'done', 45);`);
    out.afterTraining = (await attest(c.client, { id: randomUUID(), flag_id: fc, outcome: "entered_in_error", entered_in_error_confirmation: true })).code;
    out.afterTrainingStillOpen = flagRow(fc);
    const d = await plainRider("error-trained-before");
    // A session recorded BEFORE the signal never blocks the correction.
    execLocalSql(`insert into public.completed_sessions (athlete_id, session_date, session_type, completion_status, actual_duration_min) values (${lit(d.athleteId)}, ${lit(TODAY)}, 'STRENGTH_A', 'done', 45);`);
    const fd = openConcussion(d.athleteId, TODAY);
    out.trainingBefore = (await attest(d.client, { id: randomUUID(), flag_id: fd, outcome: "entered_in_error", entered_in_error_confirmation: true })).flag_status;
    const e = await plainRider("error-in-progress");
    const fe = openConcussion(e.athleteId, TODAY);
    await attest(e.client, { id: randomUUID(), flag_id: fe, outcome: "assessment_in_progress" });
    out.afterInProgress = (await attest(e.client, { id: randomUUID(), flag_id: fe, outcome: "entered_in_error", entered_in_error_confirmation: true })).code;
    report.entryError = out;
    expect(out).toEqual({
      noConfirmation: "entered_in_error_confirmation_required",
      withProfessional: "invalid_payload",
      sameDay: "resolved",
      note: "resolved|attestation:entered_in_error (déclaratif, non vérifié par NALYNT)",
      daysLater: "resolved",
      afterTraining: "entered_in_error_after_training",
      afterTrainingStillOpen: "active|-",
      trainingBefore: "resolved",
      afterInProgress: "entered_in_error_after_assessment",
    });
  });

  it("no rider is ever locked: from every open state (no attestation, legacy « monitoring », in progress, confirmed) a dated full return closes the signal; the other closures follow the transitions", async () => {
    const states = ["none", "legacy_monitoring", "assessment_in_progress", "concussion_confirmed"] as const;
    const matrix: Record<string, Record<string, string>> = {};
    for (const state of states) {
      matrix[state] = {};
      for (const outcome of ["ruled_out", "entered_in_error", "full_return_authorised"] as const) {
        const r = await plainRider(`matrix ${state}`);
        const flagId = openConcussion(r.athleteId, addCalendarDays(TODAY, -1));
        if (state === "legacy_monitoring") execLocalSql(`update public.health_flags set status = 'monitoring' where id = ${lit(flagId)};`);
        if (state === "assessment_in_progress") await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: state });
        if (state === "concussion_confirmed") await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: state, assessed_on: TODAY });
        const res = await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome, ...(outcome === "entered_in_error" ? { entered_in_error_confirmation: true } : { assessed_on: TODAY }) });
        matrix[state]![outcome] = res.status === "recorded" ? res.flag_status! : res.code!;
      }
    }
    report.resolutionMatrix = matrix;
    expect(matrix).toEqual({
      none: { ruled_out: "resolved", entered_in_error: "resolved", full_return_authorised: "resolved" },
      legacy_monitoring: { ruled_out: "resolved", entered_in_error: "resolved", full_return_authorised: "resolved" },
      assessment_in_progress: { ruled_out: "resolved", entered_in_error: "entered_in_error_after_assessment", full_return_authorised: "resolved" },
      concussion_confirmed: { ruled_out: "invalid_transition", entered_in_error: "entered_in_error_after_assessment", full_return_authorised: "resolved" },
    });
  });

  it("a signal declared DURING a guided Force session (check-in edited, A1): the next result, the resume and the completion are refused; pause and abandon accepted", async () => {
    const r = await planRider("during");
    const day = r.force[0]!;
    const s = session(r, day, await ready(r, day));
    expect(await s.start()).toBe("ok");
    expect(code(await s.result(1))).toBe("ok");
    const edited = await admin.from("daily_checkins").update({ suspected_concussion: true }).eq("athlete_id", r.athleteId).eq("checkin_date", day);
    if (edited.error) throw new Error(edited.error.message);
    const d = await rerun(r, day);
    const out = {
      decision: [d.decision, d.rules, d.prescription === undefined],
      flag: execLocalSql(`select string_agg(flag_type || ':' || status, ',') from public.health_flags where athlete_id = ${lit(r.athleteId)};`).trim(),
      result: code(await s.result(2)),
      pause: await s.ev("paused"),
      resume: await s.ev("resumed"),
      completion: await s.ev("completed"),
      abandon: await s.ev("abandoned"),
      kept: execLocalSql(`select count(*) from public.exercise_set_results where execution_id = ${lit(s.id)};`).trim(),
    };
    report.during = out;
    expect(out).toEqual({ decision: ["REST", ["A1"], true], flag: "concussion_suspect:active", result: "409 health_suspended", pause: "ok", resume: "409 health_suspended", completion: "409 health_suspended", abandon: "ok", kept: "1" });
  });

  it("a race day under an open signal: the race decision becomes REST A5, no prescription", async () => {
    const r = await plainRider("race");
    const day = addCalendarDays(TODAY, 2);
    await insertRace(admin, r.athleteId, { event_name: "A5 race", start_date: day, end_date: day, priority: "A" });
    await insertCheckin(admin, r.athleteId, day);
    const before = await rerun(r, day);
    openConcussion(r.athleteId, TODAY);
    const after = await rerun(r, day);
    const out = { before: [before.decision, before.kind, before.rules], after: [after.decision, after.kind, after.rules, after.prescription === undefined] };
    report.raceDay = out;
    expect(out).toEqual({ before: ["KEEP", "RACE_ACTIVITY", []], after: ["REST", "REST", ["A5"], true] });
  });

  it("no bypass through the Edge functions: health-flag-resolution refuses a concussion; the V1 debrief « Terminée » is refused; nothing written", async () => {
    const r = await plainRider("edge");
    const flagId = openConcussion(r.athleteId, TODAY);
    await insertCheckin(admin, r.athleteId, TODAY);
    const resolution = await invoke(r.client, "health-flag-resolution", { flagId, professionalClearance: true }, "POST");
    const debrief = await invoke(r.client, "completed-session", {
      session_date: TODAY, decision_id: null, new_pain: false, new_pain_note: null, post_leg_fatigue: null, post_grip_fatigue: null, main_content: null,
      session_type: "STRENGTH_B", completion_status: "done", actual_duration_min: 45, rpe: 6, intervention: { kind: "STRENGTH_UPPER", load_profile: "MODERATE" },
    }, "PUT");
    const out = {
      resolution: code(resolution),
      debrief: code(debrief),
      flag: flagRow(flagId),
      written: execLocalSql(`select count(*) from public.completed_sessions where athlete_id = ${lit(r.athleteId)};`).trim(),
    };
    report.edge = out;
    expect(out).toEqual({ resolution: "409 medical_validation_required", debrief: "409 health_suspended", flag: "active|-", written: "0" });
  });

  it("today's check-in still declares a suspected concussion: every closure is refused (the next analysis would reopen a signal); corrected check-in → closure accepted, no new signal", async () => {
    const r = await plainRider("checkin-first");
    await insertCheckin(admin, r.athleteId, TODAY, { suspected_concussion: true });
    const a1 = await rerun(r, TODAY);
    const flagId = execLocalSql(`select id from public.health_flags where athlete_id = ${lit(r.athleteId)} and flag_type = 'concussion_suspect';`).trim();
    const out: Record<string, unknown> = { a1: [a1.decision, a1.rules] };
    out.error = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "entered_in_error", entered_in_error_confirmation: true })).code;
    out.ruledOut = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "ruled_out", assessed_on: TODAY })).code;
    out.fullReturn = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "full_return_authorised", assessed_on: TODAY })).code;
    out.stillOpen = flagRow(flagId);
    const corrected = await admin.from("daily_checkins").update({ suspected_concussion: false }).eq("athlete_id", r.athleteId).eq("checkin_date", TODAY);
    if (corrected.error) throw new Error(corrected.error.message);
    const a5 = await rerun(r, TODAY);
    out.a5 = [a5.decision, a5.rules];
    out.errorAfterCorrection = (await attest(r.client, { id: randomUUID(), flag_id: flagId, outcome: "entered_in_error", entered_in_error_confirmation: true })).flag_status;
    const after = await rerun(r, TODAY);
    out.afterRules = after.rules;
    out.flags = execLocalSql(`select string_agg(status::text, ',' order by created_at) from public.health_flags where athlete_id = ${lit(r.athleteId)};`).trim();
    report.checkinFirst = out;
    expect(out).toEqual({
      a1: ["REST", ["A1"]],
      error: "checkin_still_declares_concussion",
      ruledOut: "checkin_still_declares_concussion",
      fullReturn: "checkin_still_declares_concussion",
      stillOpen: "active|-",
      a5: ["REST", ["A5"]],
      errorAfterCorrection: "resolved",
      afterRules: [],
      flags: "resolved",
    });
    expect(after.decision).not.toBe("REST");
  });

  it("idempotence and errors: an attestation replayed is unchanged, the same id with another content conflicts, malformed input refused, a refused start replayed stays refused", async () => {
    const a = await plainRider("idempotence");
    const flagId = openConcussion(a.athleteId, TODAY);
    const body = { id: randomUUID(), flag_id: flagId, outcome: "assessment_in_progress" };
    const first = await attest(a.client, body);
    const replay = await attest(a.client, body);
    const conflict = await attest(a.client, { ...body, outcome: "concussion_confirmed", assessed_on: TODAY });
    const unknown = await attest(a.client, { ...body, id: randomUUID(), diagnosis: "x" });
    const malformed = await attest(a.client, { id: "not-a-uuid", flag_id: flagId, outcome: "assessment_in_progress" });
    const notConcussion = execLocalSql(`insert into public.health_flags (athlete_id, flag_date, flag_type, status, description) values (${lit(a.athleteId)}, ${lit(TODAY)}, 'illness', 'active', 'Fièvre') returning id;`).trim().split("\n")[0]!.trim();
    const wrongType = await attest(a.client, { id: randomUUID(), flag_id: notConcussion, outcome: "ruled_out", assessed_on: TODAY });
    const rows = execLocalSql(`select count(*) from public.health_flag_attestations where flag_id = ${lit(flagId)};`).trim();
    const r = await planRider("refused-replay");
    const day = r.force[0]!;
    const s = session(r, day, await ready(r, day));
    openConcussion(r.athleteId, addCalendarDays(day, -1));
    const refused = await s.start();
    const refusedReplay = await s.start();
    const executions = execLocalSql(`select count(*) from public.session_executions where id = ${lit(s.id)};`).trim();
    const out = { first: first.status, replay: replay.status, conflict: conflict.code, unknown: unknown.code, malformed: malformed.code, wrongType: wrongType.code, rows, refused, refusedReplay, executions };
    report.idempotence = out;
    expect(out).toEqual({
      first: "recorded",
      replay: "unchanged",
      conflict: "id_conflict",
      unknown: "unknown_key",
      malformed: "invalid_payload",
      wrongType: "not_a_concussion_signal",
      rows: "1",
      refused: "409 health_suspended",
      refusedReplay: "409 health_suspended",
      executions: "0",
    });
  });

  it("account deletion (purge) removes the signal and its attestations; nothing else can delete them", async () => {
    const a = await plainRider("purge");
    const flagId = openConcussion(a.athleteId, TODAY);
    expect((await attest(a.client, { id: randomUUID(), flag_id: flagId, outcome: "assessment_in_progress" })).status).toBe("recorded");
    let directRowDelete = "accepted";
    try {
      execLocalSql(`delete from public.health_flag_attestations where flag_id = ${lit(flagId)};`);
    } catch (e) {
      directRowDelete = /append-only violation/.test(String(e)) ? "refused" : String(e);
    }
    execLocalSql(`select public.purge_athlete_account(${lit(a.athleteId)});`);
    const left = execLocalSql(`select (select count(*) from public.health_flag_attestations where flag_id = ${lit(flagId)}) || '|' || (select count(*) from public.health_flags where id = ${lit(flagId)});`).trim();
    report.purge = { directRowDelete, left };
    expect({ directRowDelete, left }).toEqual({ directRowDelete: "refused", left: "0|0" });
  });

  it("the V1 debrief under an open concussion signal refuses « Terminée » for any family (state, not decision); « Non réalisée » stays allowed", async () => {
    const a = await plainRider("debrief");
    openConcussion(a.athleteId, TODAY);
    const q = (status: string, family: string) => execLocalSql(`select coalesce(public.completed_session_health_block(${lit(a.athleteId)}, ${lit(TODAY)}, '${status}', '${family}'), 'allowed');`).trim();
    const out = { doneStrength: q("done", "strength"), doneDh: q("done", "dh_technical"), skipped: q("skipped", "strength") };
    report.debrief = out;
    expect(out).toEqual({ doneStrength: "health_suspended", doneDh: "health_suspended", skipped: "allowed" });
  });
});
