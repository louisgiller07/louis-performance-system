/**
 * SPORT-SAFE-02 / A5 DECISION GATE (HPM 2026-10-21) — the concussion follow-up around state changes, on the LOCAL
 * stack with the candidate A5 (every family suspended). Opt-in: RUN_LOCAL_SUPABASE_INTEGRATION=1, RUN_LOCAL_P0_EDGE=1,
 * the runtime served from this branch.
 *
 * Two kinds of cases:
 * - contract cases: what the candidate already guarantees;
 * - KNOWN GAP (`it.fails`): what the candidate contract requires and the current server guard does not do yet. Such
 *   a test passes while the gap exists and fails (to be turned into a normal test) once it is closed.
 * No production SQL; local fixtures only (owner-level SQL on the local DB container).
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral as lit } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { addCalendarDays } from "../../src/supabase/productCalendar.js";

const EDGE = localIntegrationRequested({ requirePublishableKey: true }) && process.env.RUN_LOCAL_P0_EDGE === "1";
type Body = Record<string, unknown>;
type Plan = { decision: string; final_session: { kind: string; load_profile?: string }; triggered_rules: { rule_id: string; layer: string }[] };

describe.skipIf(!EDGE)("SPORT-SAFE-02 — A5 concussion follow-up around state changes (local Edge, candidate A5)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  const report: Record<string, unknown> = {};
  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });
  afterAll(() => {
    if (process.env.SS02_A5_REPORT) writeFileSync(process.env.SS02_A5_REPORT, JSON.stringify(report, null, 2));
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

  async function rider(label: string) {
    const { athleteId } = await createTestAthlete(admin, `SS02 A5 ${label} ${randomUUID().slice(0, 6)}`);
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
    const forceDays = (data as { planned_date: string; intervention: { kind: string } | null }[]).filter((x) => x.intervention?.kind.startsWith("STRENGTH")).map((x) => x.planned_date);
    return { athleteId, client: await getAthleteAuthClient(athleteId), forceDays };
  }
  type Rider = Awaited<ReturnType<typeof rider>>;

  async function dailyRun(r: Rider, day: string) {
    const run = await invoke(r.client, "daily-run", { date: day });
    const plan = run.body.dailyPlan as Plan;
    return {
      status: run.status,
      decision: plan?.decision,
      kind: plan?.final_session.kind,
      load: plan?.final_session.load_profile ?? null,
      rules: (plan?.triggered_rules ?? []).filter((x) => x.layer === "A").map((x) => x.rule_id),
      prescription: run.body.finalPrescription as { id: string } | undefined,
    };
  }
  const openConcussion = (r: Rider, day: string) =>
    execLocalSql(`insert into public.health_flags (athlete_id, flag_date, flag_type, status, description) values (${lit(r.athleteId)}, ${lit(addCalendarDays(day, -1))}, 'concussion_suspect', 'active', 'Suspicion de commotion déclarée au checkin');`);
  const openInjury = (r: Rider, day: string) =>
    execLocalSql(`insert into public.health_flags (athlete_id, flag_date, flag_type, status, description) values (${lit(r.athleteId)}, ${lit(addCalendarDays(day, -1))}, 'injury_suspect', 'active', 'Douleur sévère déclarée (7/10) — knee_R');`);
  const resolve = (r: Rider, type: string, day: string) =>
    execLocalSql(`update public.health_flags set status = 'resolved', resolved_at = ${lit(day)} where athlete_id = ${lit(r.athleteId)} and flag_type = '${type}' and status <> 'resolved';`);
  const openFlags = (r: Rider) => execLocalSql(`select count(*) from public.health_flags where athlete_id = ${lit(r.athleteId)} and status <> 'resolved';`).trim();
  const start = (r: Rider, day: string, prescriptionId: string) => {
    const id = randomUUID();
    return invoke(r.client, "session-execution", {
      execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: prescriptionId },
      events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }],
    });
  };

  it("two signals at once: an injury follow-up (A7) and a concussion follow-up (A5) both suspend; closing the injury leaves the concussion suspension", async () => {
    const r = await rider("two-signals");
    const day = r.forceDays[0]!;
    openConcussion(r, day);
    openInjury(r, day);
    await insertCheckin(admin, r.athleteId, day);
    const both = await dailyRun(r, day);
    resolve(r, "injury_suspect", day);
    const concussionOnly = await dailyRun(r, day);
    const out = { both: [both.decision, both.rules], concussionOnly: [concussionOnly.decision, concussionOnly.rules] };
    report.twoSignals = out;
    expect(out).toEqual({ both: ["REST", ["A7"]], concussionOnly: ["REST", ["A5"]] });
  });

  it("concurrency: two daily-runs at once under an open concussion follow-up → both suspend, no new signal, decisions append-only", async () => {
    const r = await rider("concurrency");
    const day = r.forceDays[0]!;
    openConcussion(r, day);
    await insertCheckin(admin, r.athleteId, day);
    const [a, b] = await Promise.all([dailyRun(r, day), dailyRun(r, day)]);
    const decisions = execLocalSql(`select count(*) from public.decisions where athlete_id = ${lit(r.athleteId)} and decision_date = ${lit(day)};`).trim();
    const out = { a: [a.status, a.decision, a.rules], b: [b.status, b.decision, b.rules], openFlags: openFlags(r), decisions };
    report.concurrency = out;
    expect(out).toEqual({ a: [200, "REST", ["A5"]], b: [200, "REST", ["A5"]], openFlags: "1", decisions: "2" });
  });

  it("closure between two calls: until a new daily-run the suspension stands (no prescription to start); after it, the plan's own session returns at its planned dose (current behaviour: no return protocol)", async () => {
    const r = await rider("closure");
    const day = r.forceDays[0]!;
    const planned = execLocalSql(`select intervention->>'kind' || ' ' || coalesce(intervention->>'load_profile','-') from public.planned_sessions where athlete_id = ${lit(r.athleteId)} and planned_date = ${lit(day)};`).trim();
    openConcussion(r, day);
    await insertCheckin(admin, r.athleteId, day);
    const suspended = await dailyRun(r, day);
    resolve(r, "concussion_suspect", day);
    const after = await dailyRun(r, day);
    const out = { suspended: [suspended.decision, suspended.rules, suspended.prescription === undefined], after: [after.decision, `${after.kind} ${after.load ?? "-"}`] , planned };
    report.closure = out;
    expect(out.suspended).toEqual(["REST", ["A5"], true]);
    expect(out.after).toEqual(["KEEP", planned]);
  });

  // KNOWN GAP — the candidate contract: an open concussion signal suspends every family, whatever the timing. The
  // server guard (execution_health_block) blocks only a DH session on the signal itself, and otherwise relies on the
  // day's latest decision being a Safety REST; the decision currency follows the check-in and the planned session,
  // not the signals. A signal written without a new daily-run (an operator write, a future closure / reopening
  // workflow) leaves an older Force prescription startable.
  it.fails("KNOWN GAP — a Force prescription produced before the signal opened (no new daily-run) cannot be started", async () => {
    const r = await rider("stale-ready");
    const day = r.forceDays[0]!;
    await insertCheckin(admin, r.athleteId, day);
    const before = await dailyRun(r, day);
    expect([before.decision, before.prescription !== undefined]).toEqual(["KEEP", true]);
    openConcussion(r, day);
    const started = code(await start(r, day, before.prescription!.id));
    report.staleReady = { started };
    expect(started).toBe("409 health_suspended");
  });
});
