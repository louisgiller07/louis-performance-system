/**
 * UX-11R.9 — server invariants of the hardening before D2B2 (local Supabase stack only):
 * - T27 F-6A: a DH technical execution is completed only with an active pass result (`dh_pass_required`);
 * - T28 F-6B / F-5b: one main session per athlete and day (`session_already_completed`), at start and at completion;
 * - T29 F-5: persist_completed_session refuses a day completed as a guided session (SQLSTATE NX101);
 * - T31 F-4: accept_training_plan_version refuses a draft not more recent than the current plan (SQLSTATE NX102);
 * plus the legacy / V2 concurrency rules (one per-athlete lock: one branch wins, never both terminal states).
 *
 * Fixtures: hand-made v2 final prescriptions written as the local database owner (same practice as
 * executionResultIntegrity.integration.test.ts). Scratch athletes stay in the local database (append-only rows).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, generateAndAcceptTrainingPlan, generateTrainingPlan, insertCheckin } from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";

const INTEGRATION_ENABLED = localIntegrationRequested();

type Outcome = { status: "ok"; inserted: Record<string, string[]>; unchanged: Record<string, string[]> } | { status: "rejected"; code: string; target: string };

const DH_ITEM = randomUUID();
const FORCE_ITEM = randomUUID();
const dhStructure = {
  schemaVersion: "v2",
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  blocks: [{ blockId: "main", role: "main", items: [{ kind: "drill", prescriptionItemId: DH_ITEM, drillId: "cornering_off_camber", measure: { type: "pass", count: 4 } }] }],
};
const forceStructure = {
  schemaVersion: "v2",
  family: "strength",
  sessionKind: "STRENGTH_LOWER",
  blocks: [{ blockId: "main", role: "main", items: [{ kind: "exercise", prescriptionItemId: FORCE_ITEM, exerciseId: "goblet_squat", sets: 3, measure: { type: "reps", min: 6, max: 8, perSide: false } }] }],
};
const enduranceStructure = { schemaVersion: "v2", family: "endurance", activitySelection: { mode: "restricted", activityIds: ["road_bike"] }, blocks: [] };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11R.9 — execution, legacy completion and plan acceptance invariants", () => {
  let admin: SupabaseClient;
  let athleteId: string;
  /** day → its current v2 final prescription id */
  const fp = new Map<string, string>();
  let dayIndex = 0;

  async function record(payload: unknown): Promise<Outcome> {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(`record_session_execution raised: ${error.message}`);
    return data as Outcome;
  }
  /** A fresh day (own check-in, own current decision + final prescription): one scenario never leaks into another. */
  /** `dailyPlanFinalSession`: the decision's daily_plan.final_session (what the M1 bridge reads); absent by default. */
  async function freshDay(structure: unknown, finalSession = "DH_TECHNICAL", dailyPlanFinalSession?: unknown): Promise<string> {
    dayIndex += 1;
    const day = new Date(Date.UTC(2026, 11, dayIndex)).toISOString().slice(0, 10); // 2026-12-01, 2026-12-02, …
    await insertCheckin(admin, athleteId, day);
    const decisionId = randomUUID();
    const fpId = randomUUID();
    const dailyPlan = dailyPlanFinalSession === undefined ? "null" : `${sqlLiteral(JSON.stringify({ final_session: dailyPlanFinalSession }))}::jsonb`;
    execLocalSql(`insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, final_prescription_status, source_checkin_id, source_checkin_updated_at, daily_plan)
  select ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, '${finalSession}', 'test fixture', 'test', 'created', c.id, c.updated_at, ${dailyPlan}
    from public.daily_checkins c where c.athlete_id = ${sqlLiteral(athleteId)} and c.checkin_date = ${sqlLiteral(day)};
insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, adaptation_rule_ids, schema_version, catalog_version, structure)
  values (${sqlLiteral(fpId)}, ${sqlLiteral(decisionId)}, ${sqlLiteral(athleteId)}, 'no_canonical_plan', 'keep', '[]'::jsonb, 'v2', 'test', ${sqlLiteral(JSON.stringify(structure))}::jsonb);`);
    fp.set(day, fpId);
    return day;
  }
  const at = (day: string, minute: number) => `${day}T17:${String(minute).padStart(2, "0")}:00Z`;
  function execution(day: string, finalPrescriptionId: string | null = fp.get(day)!) {
    const id = randomUUID();
    const startBatch = { execution: { id, session_date: day, started_at: at(day, 0), final_prescription_id: finalPrescriptionId }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: at(day, 0) }] };
    return {
      id,
      startBatch,
      event: (event_type: string, minute = 50) => ({ id: randomUUID(), execution_id: id, event_type, occurred_at: at(day, minute) }),
      pass: (set_number: number, extra: Record<string, unknown> = {}) => ({
        id: randomUUID(),
        execution_id: id,
        prescription_item_id: DH_ITEM,
        set_number,
        done: true,
        measure_type: "pass",
        measure_value: null,
        success: true,
        occurred_at: at(day, 10 + set_number),
        ...extra,
      }),
    };
  }
  async function started(day: string) {
    const e = execution(day);
    expect(await record(e.startBatch)).toMatchObject({ status: "ok" });
    return e;
  }
  async function eventsOf(executionId: string): Promise<string[]> {
    const { data } = await admin.from("execution_events").select("event_type, event_seq").eq("execution_id", executionId).order("event_seq");
    return (data ?? []).map((row) => row.event_type as string);
  }
  async function executionsOn(day: string): Promise<number> {
    const { count } = await admin.from("session_executions").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId).eq("session_date", day);
    return count ?? 0;
  }
  const legacyRow = (day: string, status: "done" | "partial" | "skipped" | "replaced") =>
    status === "skipped"
      ? { session_date: day, decision_id: null, session_type: "DH_TECHNICAL", completion_status: "skipped", actual_duration_min: null, rpe: null, main_content: null, intervention: null, free_notes: null, post_leg_fatigue: null, post_grip_fatigue: null, new_pain: false, new_pain_note: null }
      : { session_date: day, decision_id: null, session_type: "RECOVERY", completion_status: status, actual_duration_min: 42, rpe: 6, main_content: null, intervention: { kind: "RECOVERY_ACTIVE" }, free_notes: null, post_leg_fatigue: 3, post_grip_fatigue: 3, new_pain: false, new_pain_note: null };
  async function persistLegacy(day: string, status: "done" | "partial" | "skipped" | "replaced") {
    return admin.rpc("persist_completed_session", { p_athlete_id: athleteId, p_row: legacyRow(day, status) });
  }
  async function legacyStatus(day: string): Promise<string | null> {
    const { data } = await admin.from("completed_sessions").select("completion_status").eq("athlete_id", athleteId).eq("session_date", day).maybeSingle();
    return (data?.completion_status as string | undefined) ?? null;
  }

  beforeAll(async () => {
    assertLocalDbReady();
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, "UX-11R.9 hardening")).athleteId;
  }, 60_000);

  describe("T27 — F-6A: a DH session is completed only with an active pass", () => {
    it("completed without any pass → dh_pass_required, nothing written, the execution stays open", async () => {
      const day = await freshDay(dhStructure);
      const e = await started(day);
      const completed = e.event("completed");
      expect(await record({ events: [completed] })).toEqual({ status: "rejected", code: "dh_pass_required", target: "execution" });
      expect(await eventsOf(e.id)).toEqual(["started"]);
      // A pass in the SAME batch as completed counts.
      const p1 = e.pass(1);
      expect(await record({ sets: [p1], events: [completed] })).toMatchObject({ status: "ok", inserted: { sets: [p1.id], events: [completed.id] } });
      // Idempotent replay of the completed batch: unchanged, never re-checked.
      expect(await record({ sets: [p1], events: [completed] })).toMatchObject({ status: "ok", unchanged: { sets: [p1.id], events: [completed.id] } });
    });

    it("a pass recorded before, then completed → ok; a corrected pass that is still done → ok", async () => {
      const day = await freshDay(dhStructure);
      const e = await started(day);
      const p1 = e.pass(1, { success: false });
      expect(await record({ sets: [p1] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [e.pass(1, { success: true, supersedes_id: p1.id })] })).toMatchObject({ status: "ok" });
      expect(await record({ events: [e.event("completed")] })).toMatchObject({ status: "ok" });
    });

    it("no ACTIVE done pass (only a not-done pass, or a done pass corrected to not done) → dh_pass_required", async () => {
      const notDoneDay = await freshDay(dhStructure);
      const e1 = await started(notDoneDay);
      expect(await record({ sets: [e1.pass(1, { done: false, success: null })] })).toMatchObject({ status: "ok" });
      expect(await record({ events: [e1.event("completed")] })).toMatchObject({ status: "rejected", code: "dh_pass_required" });
      await record({ events: [e1.event("abandoned")] });

      const correctedDay = await freshDay(dhStructure);
      const e2 = await started(correctedDay);
      const p1 = e2.pass(1);
      expect(await record({ sets: [p1] })).toMatchObject({ status: "ok" });
      expect(await record({ sets: [e2.pass(1, { done: false, success: null, supersedes_id: p1.id })] })).toMatchObject({ status: "ok" });
      expect(await record({ events: [e2.event("completed")] })).toMatchObject({ status: "rejected", code: "dh_pass_required" });
      expect(await record({ events: [e2.event("abandoned")] })).toMatchObject({ status: "ok" });
    });

    it("Force (F-6C: a performed work set), endurance and an execution without prescription keep their own completion rules", async () => {
      const forceDay = await freshDay(forceStructure, "STRENGTH_A");
      const f = await started(forceDay);
      const completed = f.event("completed");
      expect(await record({ events: [completed] })).toMatchObject({ status: "rejected", code: "strength_set_required" });
      const set = { id: randomUUID(), execution_id: f.id, prescription_item_id: FORCE_ITEM, set_number: 1, done: true, measure_type: "reps", measure_value: 8, occurred_at: at(forceDay, 20) };
      expect(await record({ sets: [set], events: [completed] })).toMatchObject({ status: "ok" });

      const enduranceDay = await freshDay(enduranceStructure, "AEROBIC_BASE");
      const n = await started(enduranceDay);
      expect(await record({ events: [n.event("completed")] })).toMatchObject({ status: "rejected", code: "activity_result_required" });
      await record({ events: [n.event("abandoned")] });

      const freeDay = await freshDay(dhStructure);
      const free = execution(freeDay, null);
      expect(await record(free.startBatch)).toMatchObject({ status: "ok" });
      expect(await record({ events: [free.event("completed")] })).toMatchObject({ status: "ok" });
    });
  });

  describe("T28 — F-6B / F-5b: one main session per athlete and day", () => {
    it("after a completed execution, a new normal start the same day → session_already_completed, nothing written; the start replay stays unchanged", async () => {
      const day = await freshDay(dhStructure);
      const e = await started(day);
      expect(await record({ sets: [e.pass(1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
      const again = execution(day);
      expect(await record(again.startBatch)).toEqual({ status: "rejected", code: "session_already_completed", target: "execution" });
      expect(await executionsOn(day)).toBe(1);
      expect(await record(e.startBatch)).toMatchObject({ status: "ok", unchanged: { executions: [e.id] } });
      // Another day is not affected.
      const otherDay = await freshDay(dhStructure);
      const o = await started(otherDay);
      await record({ events: [o.event("abandoned")] });
    });

    it("abandoned (never completed) → restart allowed", async () => {
      const day = await freshDay(dhStructure);
      const e = await started(day);
      expect(await record({ events: [e.event("abandoned")] })).toMatchObject({ status: "ok" });
      const restart = await started(day);
      expect(await record({ sets: [restart.pass(1)], events: [restart.event("completed")] })).toMatchObject({ status: "ok" });
      expect(await executionsOn(day)).toBe(2);
    });

    it("inverse duplicate: a legacy row that is not skipped blocks a V2 start → session_already_completed, no execution", async () => {
      for (const status of ["done", "partial", "replaced"] as const) {
        const day = await freshDay(dhStructure);
        expect((await persistLegacy(day, status)).error).toBeNull();
        expect(await record(execution(day).startBatch)).toEqual({ status: "rejected", code: "session_already_completed", target: "execution" });
        expect(await executionsOn(day)).toBe(0);
      }
    });

    it("a legacy `skipped` row does not count: the V2 session can start and complete", async () => {
      const day = await freshDay(dhStructure);
      expect((await persistLegacy(day, "skipped")).error).toBeNull();
      const e = await started(day);
      expect(await record({ sets: [e.pass(1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
    });

    it("defensive (historical / inconsistent state): a non-skipped legacy row next to an OPEN execution → completing it is session_already_completed, no second completion; abandoning stays allowed", async () => {
      const day = await freshDay(dhStructure);
      const e = await started(day);
      expect(await record({ sets: [e.pass(1)] })).toMatchObject({ status: "ok" });
      // Artificial state, owner-level (the RPC itself now refuses a debrief while the execution is open).
      execLocalSql(`insert into public.completed_sessions (athlete_id, session_date, session_type, completion_status, actual_duration_min, rpe, intervention, post_leg_fatigue, post_grip_fatigue, new_pain)
  values (${sqlLiteral(athleteId)}, ${sqlLiteral(day)}, 'RECOVERY', 'done', 42, 6, '{"kind":"RECOVERY_ACTIVE"}'::jsonb, 3, 3, false);`);
      expect(await record({ events: [e.event("completed")] })).toEqual({ status: "rejected", code: "session_already_completed", target: "execution" });
      expect(await eventsOf(e.id)).toEqual(["started"]);
      expect(await record({ events: [e.event("abandoned")] })).toMatchObject({ status: "ok" });
      expect(await eventsOf(e.id)).toEqual(["started", "abandoned"]);
    });
  });

  describe("T29 — F-5: the legacy debrief is refused for a day completed as a guided session", () => {
    it("insert refused with SQLSTATE NX101, nothing written", async () => {
      const day = await freshDay(dhStructure);
      const e = await started(day);
      expect(await record({ sets: [e.pass(1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
      const { data, error } = await persistLegacy(day, "done");
      expect(data).toBeNull();
      expect(error?.code).toBe("NX101");
      expect(await legacyStatus(day)).toBeNull();
    });

    it("replacement of an existing legacy row refused too (the row is never modified)", async () => {
      const day = await freshDay(dhStructure);
      expect((await persistLegacy(day, "skipped")).error).toBeNull();
      const e = await started(day);
      expect(await record({ sets: [e.pass(1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
      expect((await persistLegacy(day, "done")).error?.code).toBe("NX101");
      expect(await legacyStatus(day)).toBe("skipped");
    });

    it("F-5b — an OPEN guided session (started, paused, resumed) reserves the day: legacy debrief → NX101, nothing written", async () => {
      for (const lifecycle of [[], ["paused"], ["paused", "resumed"]]) {
        const day = await freshDay(dhStructure);
        const e = await started(day);
        for (const [i, event] of lifecycle.entries()) expect(await record({ events: [e.event(event, 5 + i)] })).toMatchObject({ status: "ok" });
        const { error } = await persistLegacy(day, "done");
        expect(error?.code).toBe("NX101");
        expect(await legacyStatus(day)).toBeNull();
        // The open session can still be completed normally.
        expect(await record({ sets: [e.pass(1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
      }
    });

    it("an abandoned execution (or none) leaves the legacy debrief open; another date is unaffected", async () => {
      const abandonedDay = await freshDay(dhStructure);
      const a = await started(abandonedDay);
      await record({ events: [a.event("abandoned")] });
      expect((await persistLegacy(abandonedDay, "partial")).error).toBeNull();

      const legacyOnlyDay = await freshDay(dhStructure);
      expect((await persistLegacy(legacyOnlyDay, "done")).error).toBeNull();
      expect(await legacyStatus(legacyOnlyDay)).toBe("done");
    });

    it("a V1 athlete (no execution at all) keeps the legacy behaviour, replacement included", async () => {
      const v1 = (await createTestAthlete(admin, "UX-11R.9 legacy only")).athleteId;
      const row = legacyRow("2026-11-20", "done");
      expect((await admin.rpc("persist_completed_session", { p_athlete_id: v1, p_row: row })).error).toBeNull();
      expect((await admin.rpc("persist_completed_session", { p_athlete_id: v1, p_row: { ...row, rpe: 8 } })).error).toBeNull();
    });
  });

  describe("concurrency — one per-athlete lock: one branch wins, never two terminal states for a day", () => {
    it("V2 completion and legacy debrief sent together, repeatedly: exactly one wins", async () => {
      for (let round = 0; round < 6; round += 1) {
        const day = await freshDay(dhStructure);
        const e = await started(day);
        const [v2, legacy] = await Promise.all([record({ sets: [e.pass(1)], events: [e.event("completed")] }), persistLegacy(day, "done")]);
        const v2Won = v2.status === "ok";
        const legacyWon = legacy.error === null;
        expect(v2Won !== legacyWon).toBe(true);
        if (v2Won) expect(legacy.error?.code).toBe("NX101");
        else expect(v2).toMatchObject({ status: "rejected", code: "session_already_completed" });
        const done = (await eventsOf(e.id)).includes("completed");
        const legacyDone = (await legacyStatus(day)) === "done";
        expect(done && legacyDone).toBe(false);
      }
    });

    it("F-5b — V2 start and legacy debrief sent together, repeatedly: exactly one wins; never an active execution plus a non-skipped legacy row", async () => {
      const winners = { start: 0, legacy: 0 };
      for (let round = 0; round < 8; round += 1) {
        const day = await freshDay(dhStructure);
        const e = execution(day);
        const [start, legacy] = await Promise.all([record(e.startBatch), persistLegacy(day, "done")]);
        const startWon = start.status === "ok";
        const legacyWon = legacy.error === null;
        expect(startWon !== legacyWon).toBe(true);
        if (startWon) {
          winners.start += 1;
          expect(legacy.error?.code).toBe("NX101");
          expect(await legacyStatus(day)).toBeNull();
        } else {
          winners.legacy += 1;
          expect(start).toEqual({ status: "rejected", code: "session_already_completed", target: "execution" });
          expect(await executionsOn(day)).toBe(0);
        }
      }
      expect(winners.start + winners.legacy).toBe(8);
    });
  });

  describe("F-5d — canonical precedence: legacy skipped + V2 completed = V2 completed (bridge / M1)", () => {
    it("the next Daily's recent sessions and recovery context see the completed guided session, not the skipped row", async () => {
      const { computeDailyFor } = await import("../../src/supabase/computeDailyFor.js");
      const day = await freshDay(dhStructure, "DH_TECHNICAL", { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 });
      expect((await persistLegacy(day, "skipped")).error).toBeNull();
      const e = await started(day);
      expect(await record({ sets: [e.pass(1)], events: [e.event("completed")] })).toMatchObject({ status: "ok" });
      const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      await insertCheckin(admin, athleteId, next);
      const { rawContext } = await computeDailyFor(admin, athleteId, next);
      const sessionsOfDay = rawContext.recent_sessions.filter((s) => s.date === day);
      expect(sessionsOfDay).toEqual([{ date: day, intervention: expect.objectContaining({ kind: "DH_TECHNICAL" }), completion_status: "done" }]);
      expect(JSON.stringify(rawContext.recent_recovery_context ?? null)).not.toContain("skipped");
    });
  });

  describe("T31 — F-4: a draft not more recent than the current plan cannot be accepted", () => {
    const window = { horizonStartDate: "2027-01-04", horizonEndDate: "2027-01-10", sessions: [{ date: "2027-01-05", kind: "REST" }] };
    async function currentPlan(athlete: string): Promise<string | null> {
      const { data } = await admin.from("training_plan_current_version").select("plan_version_id").eq("athlete_id", athlete).maybeSingle();
      return (data?.plan_version_id as string | undefined) ?? null;
    }
    async function transitionsOf(planVersionId: string): Promise<string[]> {
      const { data } = await admin.from("training_plan_version_lifecycle_transitions").select("state, transition_number").eq("plan_version_id", planVersionId).order("transition_number");
      return (data ?? []).map((row) => row.state as string);
    }
    const accept = (athlete: string, planVersionId: string) => admin.rpc("accept_training_plan_version", { p_athlete_id: athlete, p_plan_version_id: planVersionId });

    it("older draft → NX102, no transition; newer draft → accepted; replay of the current → idempotent", async () => {
      const athlete = (await createTestAthlete(admin, "UX-11R.9 stale plan")).athleteId;
      const older = await generateTrainingPlan(admin, athlete, window);
      const current = await generateAndAcceptTrainingPlan(admin, athlete, window);
      const stale = await accept(athlete, older.planVersionId);
      expect(stale.error?.code).toBe("NX102");
      expect(await transitionsOf(older.planVersionId)).toEqual(["draft"]);
      expect(await transitionsOf(current.planVersionId)).toEqual(["draft", "accepted"]);
      expect(await currentPlan(athlete)).toBe(current.planVersionId);

      const newer = await generateTrainingPlan(admin, athlete, window);
      const accepted = await accept(athlete, newer.planVersionId);
      expect(accepted.error).toBeNull();
      expect(await currentPlan(athlete)).toBe(newer.planVersionId);
      expect(await transitionsOf(current.planVersionId)).toEqual(["draft", "accepted", "superseded"]);

      const replay = await accept(athlete, newer.planVersionId);
      expect(replay.error).toBeNull();
      expect(replay.data).toMatchObject({ plan_version_id: newer.planVersionId, idempotent_replay: true });
    });

    it("equal generated_at → stale (strictly more recent required)", async () => {
      const athlete = (await createTestAthlete(admin, "UX-11R.9 equal plan")).athleteId;
      const current = await generateAndAcceptTrainingPlan(admin, athlete, window);
      const twin = await generateTrainingPlan(admin, athlete, window);
      // Owner-level, local only: give the draft exactly the current plan's generated_at (append-only triggers bypassed for this one statement).
      execLocalSql(`begin;
set local session_replication_role = replica;
update public.training_plan_versions set generated_at = (select generated_at from public.training_plan_versions where id = ${sqlLiteral(current.planVersionId)}) where id = ${sqlLiteral(twin.planVersionId)};
commit;`);
      expect((await accept(athlete, twin.planVersionId)).error?.code).toBe("NX102");
      expect(await currentPlan(athlete)).toBe(current.planVersionId);
    });

    it("first plan (no current version) is accepted as before", async () => {
      const athlete = (await createTestAthlete(admin, "UX-11R.9 first plan")).athleteId;
      const first = await generateTrainingPlan(admin, athlete, window);
      expect((await accept(athlete, first.planVersionId)).error).toBeNull();
      expect(await currentPlan(athlete)).toBe(first.planVersionId);
    });

    it("two acceptances racing: a candidate that became stale never becomes current", async () => {
      for (let round = 0; round < 4; round += 1) {
        const athlete = (await createTestAthlete(admin, `UX-11R.9 race ${round}`)).athleteId;
        await generateAndAcceptTrainingPlan(admin, athlete, window);
        const a = await generateTrainingPlan(admin, athlete, window);
        const b = await generateTrainingPlan(admin, athlete, window); // newest
        const [ra, rb] = await Promise.all([accept(athlete, a.planVersionId), accept(athlete, b.planVersionId)]);
        expect(rb.error).toBeNull();
        if (ra.error) expect(ra.error.code).toBe("NX102");
        expect(await currentPlan(athlete)).toBe(b.planVersionId);
      }
    });
  });

  describe("T32 — the rollback scripts restore exactly the pre-UX-11R.9 function bodies", () => {
    const repo = new URL("../../../", import.meta.url);
    const cases = [
      { fn: "record_session_execution(uuid, jsonb)", rollback: "20261005120000_rollback_record_session_execution.sql", source: "20261002090000_ux11b26_execution_result_integrity.sql", name: "record_session_execution" },
      { fn: "persist_completed_session(uuid, jsonb)", rollback: "20261005120500_rollback_persist_completed_session.sql", source: "20260910090000_v0_3_007c_completed_sessions_debrief_fields.sql", name: "persist_completed_session" },
      { fn: "accept_training_plan_version(uuid, uuid)", rollback: "20261005121000_rollback_accept_training_plan_version.sql", source: "20260921092500_v0_4_001f_accept_training_plan_version_rpc.sql", name: "accept_training_plan_version" },
    ];
    // Carriage returns normalized: a Windows working copy may hold CRLF, production bodies are LF.
    const fingerprint = (fn: string) => `select md5(replace(pg_get_functiondef('public.${fn}'::regprocedure), chr(13), ''));`;
    const md5Lines = (output: string) => output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[0-9a-f]{32}$/.test(line));
    const inRolledBackTransaction = (body: string, fn: string) => md5Lines(execLocalSql(`begin;\n${body}\n${fingerprint(fn)}\nrollback;`)).at(-1);

    for (const c of cases) {
      it(`${c.name}: rollback script = body of ${c.source}; the migrated body differs`, () => {
        const rollback = readFileSync(new URL(`supabase/rollbacks/ux11r9/${c.rollback}`, repo), "utf8");
        const source = readFileSync(new URL(`supabase/migrations/${c.source}`, repo), "utf8").split(String.fromCharCode(13)).join("");
        const start = source.indexOf(`create or replace function public.${c.name}`);
        const end = source.indexOf("$$;", source.indexOf("as $$", start)) + 3;
        const sourceBlock = source.slice(start, end);
        const restored = inRolledBackTransaction(rollback, c.fn);
        expect(restored).toMatch(/^[0-9a-f]{32}$/);
        expect(restored).toBe(inRolledBackTransaction(sourceBlock, c.fn));
        expect(md5Lines(execLocalSql(fingerprint(c.fn))).at(-1)).not.toBe(restored);
      });
    }
  });
});
