/**
 * CONSISTENCY-01 (HPM 2026-10-16, O-43 / O-46) — Today's mission follows the ACTIVE programme.
 *
 * A manual `planned_sessions` row is part of the active programme only when it was written after this programme
 * became current (`training_plan_current_version.updated_at`): the rider's own modifications (V06-02, UX-10B-2B,
 * P0-3) stay untouched. An OLDER manual row, dated in the projection window and inside the programme's horizon, is
 * superseded by the programme: replaced by the programme's session on a programme day, removed on a programme rest
 * day — exactly as PILOT_022 already treats the generated rows of a superseded plan. Days already used (guided
 * session started or completed, V1 debrief), days before the window (history) and dates outside the horizon are
 * never touched; decisions, executions and debriefs are never rewritten.
 *
 * Local Supabase only (RUN_LOCAL_SUPABASE_INTEGRATION=1), fictitious riders. "Old" rows are either written before
 * the acceptance (the real path) or inserted with an `updated_at` in the past (same state, deterministic).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { projectTrainingPlan } from "../../src/supabase/projectTrainingPlan.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor, type RunDailyForDeps } from "../../src/supabase/runDailyFor.js";

const ENABLED = localIntegrationRequested();

/** Production configuration: the daily run projects the programme before deciding (TRAINING_PLAN_PROJECTION_WINDOW_DAYS). */
const PROJECTING: RunDailyForDeps = { ...DEFAULT_RUN_DAILY_FOR_DEPS, resolveTrainingPlanProjectionWindow: () => ({ enabled: true, windowDays: 14 }) };
/** A daily run that does not project (used only to build a state BEFORE the reconciliation runs). */
const NOT_PROJECTING: RunDailyForDeps = { ...DEFAULT_RUN_DAILY_FOR_DEPS, resolveTrainingPlanProjectionWindow: () => ({ enabled: false }) };

const OLD_DH = { kind: "DH_PERFORMANCE", load_profile: "HEAVY", duration_min: 240 } as const;
const AGGRAVATING_PAIN = { pain: true, pain_intensity: 5, pain_new: false, pain_location_code: "knee_R", pain_traumatic: false, pain_function_loss: false, pain_getting_worse: true };
/** Long before any acceptance in these tests: the state of a row written under an earlier programme. */
const BEFORE_THE_PROGRAMME = "2026-09-01T08:00:00Z";

const addDays = (iso: string, n: number) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)).toISOString().slice(0, 10);

interface Rider {
  athleteId: string;
  planVersionId: string;
  /** date → kind of the programme's generated session (rest days are absent). */
  sessions: Map<string, string>;
  horizonEnd: string;
}

interface PlannedRow {
  source: string;
  session_type: string;
  intervention: { kind: string; load_profile?: string; duration_min?: number } | null;
  source_plan_version_id: string | null;
  is_committed: boolean;
}

describe.skipIf(!ENABLED)("CONSISTENCY-01 — Today follows the active programme (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  /** A fictitious DH rider with a 6-week V2 programme generated on 2026-10-04; `beforeAccept` runs on the draft. */
  async function rider(name: string, beforeAccept?: (athleteId: string, sessions: Map<string, string>) => Promise<void>): Promise<Rider> {
    const { athleteId } = await createTestAthlete(admin, `CONSISTENCY-01 ${name}`);
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
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04" },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error(`plan not persisted: ${persisted.status}`);
    const { data } = await admin.from("training_plan_generated_sessions").select("date, kind").eq("plan_version_id", persisted.planVersionId);
    const sessions = new Map((data as { date: string; kind: string }[]).map((s) => [s.date, s.kind]));
    const { data: version } = await admin.from("training_plan_versions").select("horizon_end_date").eq("id", persisted.planVersionId).single();
    if (beforeAccept) await beforeAccept(athleteId, sessions);
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    return { athleteId, planVersionId: persisted.planVersionId, sessions, horizonEnd: (version as { horizon_end_date: string }).horizon_end_date };
  }

  const firstDate = (r: Pick<Rider, "horizonEnd">, from: string, ok: (date: string) => boolean): string => {
    for (let d = from; d <= r.horizonEnd; d = addDays(d, 1)) if (ok(d)) return d;
    throw new Error("no matching date in the horizon");
  };
  const restDay = (r: Pick<Rider, "horizonEnd" | "sessions">, from: string) => firstDate(r, from, (d) => !r.sessions.has(d));
  const trainingDay = (r: Pick<Rider, "horizonEnd" | "sessions">, from: string) => firstDate(r, from, (d) => r.sessions.has(d));

  /** The rider writes a manual session for `date` from /plan (RLS client, as the web does): an athlete modification. */
  async function riderWrites(athleteId: string, date: string, intervention: { kind: string; load_profile: string; duration_min: number }) {
    const { error } = await (await getAthleteAuthClient(athleteId))
      .from("planned_sessions")
      .upsert(
        { athlete_id: athleteId, planned_date: date, session_type: intervention.kind, intervention, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null },
        { onConflict: "athlete_id,planned_date" }
      );
    if (error) throw new Error(error.message);
  }

  /**
   * A manual row left by an earlier programme / earlier planning (written before the current acceptance). Local fixture
   * through SQL: service_role holds no direct write on planned_sessions (V0.4_002d), the web writes as the rider.
   */
  function oldManualRow(athleteId: string, date: string, committed = false) {
    execLocalSql(`insert into public.planned_sessions (athlete_id, planned_date, session_type, intervention, planned_intent, source, is_committed, notes, created_at, updated_at)
      values (${sqlLiteral(athleteId)}, ${sqlLiteral(date)}, 'DH_PERFORMANCE', '${JSON.stringify(OLD_DH)}'::jsonb, 'old intent', 'manual', ${committed}, 'old note', '${BEFORE_THE_PROGRAMME}', '${BEFORE_THE_PROGRAMME}');`);
  }

  const plannedRow = async (athleteId: string, date: string): Promise<PlannedRow | null> => {
    const { data, error } = await admin.from("planned_sessions").select("source, session_type, intervention, source_plan_version_id, is_committed").eq("athlete_id", athleteId).eq("planned_date", date).maybeSingle();
    if (error) throw new Error(error.message);
    return data as PlannedRow | null;
  };
  /** Today's "Prochaine étape" (todayContext.nextPlannedSession): the first training row strictly after `today`. */
  const nextStep = async (athleteId: string, today: string) => {
    const { data } = await admin.from("planned_sessions").select("planned_date, session_type, source").eq("athlete_id", athleteId).gt("planned_date", today).neq("session_type", "REST").order("planned_date").limit(1);
    return ((data ?? []) as { planned_date: string; session_type: string; source: string }[])[0] ?? null;
  };
  const originOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("active_session_origin, plan_version_id").eq("decision_id", decisionId).maybeSingle();
    return data as { active_session_origin: string; plan_version_id: string } | null;
  };
  const rulesOf = (p: { triggered_rules: { rule_id: string }[] }) => p.triggered_rules.map((r) => r.rule_id).filter((r) => /^A\d$/.test(r));
  const decisionsOf = async (athleteId: string) => {
    const { data } = await admin.from("decisions").select("id, decision_date, daily_plan").eq("athlete_id", athleteId).order("created_at");
    return (data ?? []) as { id: string; decision_date: string; daily_plan: { decision: string; planned_session_before: { kind: string } | null } }[];
  };

  it("new programme after an old manual session: a programme rest day is not turned into the old DH 4 h (Today, next step, programme agree)", async () => {
    let day = "";
    const r = await rider("rest-day", async (athleteId, sessions) => {
      day = restDay({ sessions, horizonEnd: "2026-11-15" }, "2026-10-19");
      await riderWrites(athleteId, day, OLD_DH); // written under the previous planning, before this acceptance
    });
    expect(r.sessions.has(day)).toBe(false); // the programme has a rest day there
    expect(await plannedRow(r.athleteId, day)).toBeNull(); // superseded at the acceptance (window 2026-10-05 →)
    expect((await nextStep(r.athleteId, addDays(day, -1)))?.planned_date).not.toBe(day);

    await insertCheckin(admin, r.athleteId, day);
    const d = await runDailyFor(admin, r.athleteId, day, PROJECTING);
    expect(d.dailyPlan.planned_session_before).toBeNull();
    expect(d.dailyPlan.final_session.kind).not.toBe("DH_PERFORMANCE");
  });

  it("an old manual session on a programme day gives way to the programme's session (lineage, content and prescription of the active programme)", async () => {
    let day = "";
    const r = await rider("training-day", async (athleteId, sessions) => {
      day = trainingDay({ sessions, horizonEnd: "2026-11-15" }, "2026-10-19");
      await riderWrites(athleteId, day, OLD_DH);
    });
    const row = await plannedRow(r.athleteId, day);
    expect([row?.source, row?.intervention?.kind, row?.source_plan_version_id, row?.is_committed]).toEqual(["generated", r.sessions.get(day), r.planVersionId, false]);

    await insertCheckin(admin, r.athleteId, day);
    const d = await runDailyFor(admin, r.athleteId, day, PROJECTING);
    expect(d.dailyPlan.planned_session_before?.kind).toBe(r.sessions.get(day));
    if (d.dailyPlan.decision === "KEEP") {
      expect(d.finalPrescriptionStatus).toBe("created");
      expect(await originOf(d.persistence.decision_id)).toEqual({ active_session_origin: "generated", plan_version_id: r.planVersionId });
    }
  });

  it("an old row's manual-only fields never leak into the programme's session (commitment, intent, note)", async () => {
    const r = await rider("fields");
    const day = trainingDay(r, "2026-10-26");
    // Replace the projected row by an old committed manual row (fixture: the state left by an earlier planning).
    execLocalSql(`delete from public.planned_sessions where athlete_id = ${sqlLiteral(r.athleteId)} and planned_date = ${sqlLiteral(day)};`);
    oldManualRow(r.athleteId, day, true);
    await projectTrainingPlan(admin, r.athleteId, "2026-10-20", "2026-11-03");
    const raw = execLocalSql(`select source || '|' || coalesce(planned_intent, '-') || '|' || is_committed || '|' || coalesce(notes, '-') from public.planned_sessions where athlete_id = ${sqlLiteral(r.athleteId)} and planned_date = ${sqlLiteral(day)};`).trim();
    expect(raw).toBe("generated|-|false|-");
  });

  it("the rider's own modification made AFTER the acceptance stays the day's session (P0-3 unchanged): same day as a prescription, and on a rest day", async () => {
    const r = await rider("rider-edit");
    const day = trainingDay(r, "2026-10-19");
    const extra = restDay(r, "2026-10-19");
    const edited = { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 };
    await riderWrites(r.athleteId, day, edited);
    await riderWrites(r.athleteId, extra, edited);

    await insertCheckin(admin, r.athleteId, day);
    const d = await runDailyFor(admin, r.athleteId, day, PROJECTING); // the projection runs first and must keep both
    expect((await plannedRow(r.athleteId, day))?.source).toBe("manual");
    expect((await plannedRow(r.athleteId, extra))?.source).toBe("manual");
    expect(d.dailyPlan.planned_session_before?.kind).toBe("AEROBIC_BASE");
    if (d.dailyPlan.decision === "KEEP") expect((await originOf(d.persistence.decision_id))?.active_session_origin).toBe("manual_override_new_kind");
  });

  it("history: a day before the projection window keeps its old row and its decision; reconciled days are re-decided, never duplicated or lost", async () => {
    const r = await rider("history");
    const past = restDay(r, "2026-10-19");
    const later = restDay(r, addDays(past, 1));
    oldManualRow(r.athleteId, past);
    oldManualRow(r.athleteId, later);
    // The decision of `past` was taken on the old row (a decision already in the history before the reconciliation).
    await insertCheckin(admin, r.athleteId, past);
    const before = await runDailyFor(admin, r.athleteId, past, NOT_PROJECTING);
    expect([before.dailyPlan.decision, before.dailyPlan.final_session.kind]).toEqual(["KEEP", "DH_PERFORMANCE"]);
    const { count: debriefs } = await admin.from("completed_sessions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);

    // The rider's next day: the daily run of `later` projects from `later` (window start = the new date).
    await insertCheckin(admin, r.athleteId, later);
    const next = await runDailyFor(admin, r.athleteId, later, PROJECTING);
    expect(await plannedRow(r.athleteId, later)).toBeNull();
    expect(next.dailyPlan.planned_session_before).toBeNull();
    // `past` is before the window: its row and its decision are untouched (history), nothing is duplicated.
    expect((await plannedRow(r.athleteId, past))?.intervention).toEqual(OLD_DH);
    const decisions = await decisionsOf(r.athleteId);
    expect(decisions.map((x) => x.decision_date)).toEqual([past, later]);
    expect(decisions[0]).toMatchObject({ id: before.persistence.decision_id, daily_plan: { decision: "KEEP", planned_session_before: { kind: "DH_PERFORMANCE" } } });
    const { count: debriefsAfter } = await admin.from("completed_sessions").select("id", { count: "exact", head: true }).eq("athlete_id", r.athleteId);
    expect(debriefsAfter).toBe(debriefs);
  });

  it("date change: the reconciliation follows the day of the run — a decision taken on the old row becomes non-current, the new decision follows the programme", async () => {
    const r = await rider("date-change");
    const day = restDay(r, "2026-10-19");
    oldManualRow(r.athleteId, day);
    await insertCheckin(admin, r.athleteId, day);
    const stale = await runDailyFor(admin, r.athleteId, day, NOT_PROJECTING);
    expect(stale.dailyPlan.final_session.kind).toBe("DH_PERFORMANCE");
    // Same day, run again with the production projection: the old row goes, the earlier decision no longer matches its inputs.
    const fresh = await runDailyFor(admin, r.athleteId, day, PROJECTING);
    expect(fresh.dailyPlan.planned_session_before).toBeNull();
    const { data: currency } = await admin.from("daily_decision_currency").select("decision_id, is_current").in("decision_id", [stale.persistence.decision_id, fresh.persistence.decision_id]);
    const byId = new Map(((currency ?? []) as { decision_id: string; is_current: boolean }[]).map((c) => [c.decision_id, c.is_current]));
    expect([byId.get(stale.persistence.decision_id), byId.get(fresh.persistence.decision_id)]).toEqual([false, true]);
  });

  it("a guided session in progress keeps its day untouched, even on an old manual row (P0-3 day lock)", async () => {
    const r = await rider("guided");
    const day = trainingDay(r, "2026-10-19");
    await insertCheckin(admin, r.athleteId, day);
    const d = await runDailyFor(admin, r.athleteId, day, PROJECTING);
    expect([d.dailyPlan.decision, d.finalPrescriptionStatus]).toEqual(["KEEP", "created"]);
    const { data: fp } = await admin.from("decision_final_prescriptions").select("id").eq("decision_id", d.persistence.decision_id).single();
    const exec = randomUUID();
    const { data: started, error } = await admin.rpc("record_session_execution", {
      p_athlete_id: r.athleteId,
      p_payload: { execution: { id: exec, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: (fp as { id: string }).id }, events: [{ id: randomUUID(), execution_id: exec, event_type: "started", occurred_at: `${day}T17:00:00Z` }] },
    });
    expect([error, (started as { status: string }).status]).toEqual([null, "ok"]);
    // Fixture: the day's row becomes an old manual row (triggers bypassed — local fixture only, the lock refuses it otherwise).
    execLocalSql(`set session_replication_role = replica; update public.planned_sessions set source = 'manual', intervention = '${JSON.stringify(OLD_DH)}'::jsonb, session_type = 'DH_PERFORMANCE', updated_at = '${BEFORE_THE_PROGRAMME}' where athlete_id = ${sqlLiteral(r.athleteId)} and planned_date = ${sqlLiteral(day)};`);
    const report = await projectTrainingPlan(admin, r.athleteId, day, addDays(day, 14));
    expect(report.plannedSessions.filter((s) => s.date === day).map((s) => s.outcome)).toContain("skipped_completed");
    expect((await plannedRow(r.athleteId, day))?.source).toBe("manual");
    const { data: events } = await admin.from("execution_events").select("event_type").eq("execution_id", exec);
    expect(events).toEqual([{ event_type: "started" }]);
  });

  it("a blocking health signal stays first, and the old DH row is no longer announced as the next step", async () => {
    let day = "";
    const r = await rider("health", async (athleteId, sessions) => {
      day = restDay({ sessions, horizonEnd: "2026-11-15" }, "2026-10-19");
      await riderWrites(athleteId, day, OLD_DH);
    });
    await insertCheckin(admin, r.athleteId, addDays(day, -1), AGGRAVATING_PAIN);
    const signal = await runDailyFor(admin, r.athleteId, addDays(day, -1), PROJECTING);
    expect(signal.dailyPlan.decision).toBe("REST");
    expect((await nextStep(r.athleteId, addDays(day, -1)))?.planned_date).not.toBe(day);
    await insertCheckin(admin, r.athleteId, day);
    const d = await runDailyFor(admin, r.athleteId, day, PROJECTING);
    expect([d.dailyPlan.decision, rulesOf(d.dailyPlan)]).toEqual(["REST", ["A7"]]);
  });

  it("outside the active programme nothing changes: a date after the horizon, and a projection called without a window", async () => {
    const r = await rider("outside");
    const after = addDays(r.horizonEnd, 3);
    const inside = restDay(r, "2026-10-26");
    oldManualRow(r.athleteId, after);
    oldManualRow(r.athleteId, inside);
    // Legacy call shape (no p_window_start): previous behaviour, manual rows untouched.
    const { error } = await admin.rpc("project_training_plan", { p_athlete_id: r.athleteId, p_plan_version_id: r.planVersionId, p_planned_session_candidates: [], p_training_block_candidate: null });
    expect(error).toBeNull();
    expect((await plannedRow(r.athleteId, inside))?.source).toBe("manual");
    // Production call (window from 2026-10-20): the row inside the horizon goes, the one after the horizon stays.
    await projectTrainingPlan(admin, r.athleteId, "2026-10-20", "2026-11-03");
    expect(await plannedRow(r.athleteId, inside)).toBeNull();
    expect((await plannedRow(r.athleteId, after))?.source).toBe("manual");
  });
});
