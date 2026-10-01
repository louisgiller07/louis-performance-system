/**
 * UX-11A.5c.2 — V2 daily persistence (real local Supabase only):
 * persist_daily_run_v2 (decision + durable final prescription status + at
 * most one final prescription, all or nothing), unique (decision_id), and
 * record_session_execution accepting only the current decision's final
 * prescription. runDailyFor is NOT wired (5c.3): the RPC is called directly
 * with payloads built as 5c.3 will build them.
 *
 * Owner-level SQL (`docker exec psql` on the local supabase_db_* container
 * only) is used solely to prove what the API roles cannot do.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildKeepFinalPrescriptionV2, type FinalPrescriptionV2 } from "planning-engine/session-model-v2";
import {
  createTestAthlete,
  createTestClient,
  getAthleteAuthClient,
  insertCheckin,
  setAthleteDiscipline,
} from "./testDb.js";
import { assertLocalDbReady, execLocalSql, localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";

// Skipped only when integration is NOT requested; requested but unusable -> throws (the file fails).
const INTEGRATION_ENABLED = localIntegrationRequested({ requirePublishableKey: true });

const TODAY = "2026-10-05";
const STRENGTH_DAY = "2026-10-07"; // STRENGTH_LOWER MODERATE 60 in the development plan (the KEEP source)
// Decision days, one per scenario (the day's current decision must not be shared between scenarios).
const REFUSAL_DAY = "2026-10-12";
const UNIQUE_DAY = "2026-10-13";
const CURRENT_DAY = "2026-10-14";
const RLS_DAY = "2026-10-17";

const PROFILE: AthletePerformanceProfileWriteFields = {
  strength_experience_tier: "intermediate",
  equipment: ["dumbbells", "bench"],
  terrain_access: ["flow_trail", "bermed_trail"],
  declared_limitations: [],
  technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  dh_technical_tier: "intermediate",
};

type Decision = "KEEP" | "MODIFY" | "REPLACE" | "REST";
type Checkin = { id: string; updated_at: string };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11A.5c.2 — V2 daily persistence (local Supabase)", () => {
  let admin: SupabaseClient;

  /** An athlete with a persisted V2 development plan (not accepted: lineage is built by hand here, read in 5c.3). */
  interface Fixture {
    athleteId: string;
    planVersionId: string;
    strengthSession: { id: string; kind: string; load_profile: "MODERATE"; duration_min: number };
    strengthPlanned: { id: string; generated_plan_session_id: string; schema_version: string; catalog_version: string; structure: unknown };
  }

  async function seed(name: string): Promise<Fixture> {
    const athlete = await createTestAthlete(admin, name);
    await setAthleteDiscipline(admin, athlete.athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athlete.athleteId, PROFILE);
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athlete.athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId: athlete.athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: TODAY });
    if (persisted.status !== "persisted") throw new Error("expected a persisted V2 plan");
    const { data: session } = await admin
      .from("training_plan_generated_sessions")
      .select("id, kind, load_profile, duration_min")
      .eq("plan_version_id", persisted.planVersionId)
      .eq("date", STRENGTH_DAY)
      .single();
    const { data: planned } = await admin
      .from("training_plan_planned_prescriptions")
      .select("id, generated_plan_session_id, schema_version, catalog_version, structure")
      .eq("generated_plan_session_id", session!.id)
      .single();
    return { athleteId: athlete.athleteId, planVersionId: persisted.planVersionId, strengthSession: session as Fixture["strengthSession"], strengthPlanned: planned as Fixture["strengthPlanned"] };
  }

  async function checkin(athleteId: string, day: string): Promise<Checkin> {
    await insertCheckin(admin, athleteId, day);
    const { data } = await admin.from("daily_checkins").select("id, updated_at").eq("athlete_id", athleteId).eq("checkin_date", day).single();
    return data as Checkin;
  }

  function decisionRow(id: string, athleteId: string, day: string, decision: Decision, c: Checkin | null) {
    return {
      id,
      athlete_id: athleteId,
      decision_date: day,
      planned_session_before: decision === "REST" ? null : "STRENGTH_A",
      final_session: decision === "REST" ? "REST" : "STRENGTH_A",
      reason: "UX-11A.5c.2 test",
      do_not_do: [],
      override_reason: null,
      engine_version: "test",
      daily_plan: { date: day, decision },
      active_mode: "UNSPECIFIED",
      confidence_level: "MEDIUM",
      ...(c ? { source_checkin_id: c.id, source_checkin_updated_at: c.updated_at } : {}),
    };
  }

  /** The KEEP document exactly as 5c.1 builds it from the persisted plan rows. */
  function keep(f: Fixture, decisionId: string): FinalPrescriptionV2 {
    const r = buildKeepFinalPrescriptionV2({
      finalPrescriptionId: randomUUID(),
      decision: { decisionId, decision: "KEEP", finalSession: { kind: "STRENGTH_LOWER", loadProfile: "MODERATE", durationMin: f.strengthSession.duration_min } },
      lineage: {
        plannedSessionSource: "generated",
        sourcePlanVersionId: f.planVersionId,
        sourceGeneratedSessionId: f.strengthSession.id,
        currentPlanVersionId: f.planVersionId,
        generatedSession: { id: f.strengthSession.id, kind: f.strengthSession.kind, loadProfile: f.strengthSession.load_profile, durationMin: f.strengthSession.duration_min },
      },
      plannedPrescription: {
        id: f.strengthPlanned.id,
        generatedPlanSessionId: f.strengthPlanned.generated_plan_session_id,
        schemaVersion: f.strengthPlanned.schema_version,
        catalogVersion: f.strengthPlanned.catalog_version,
        structure: f.strengthPlanned.structure,
      },
    });
    if (r.status !== "created") throw new Error(`expected a KEEP document, got ${JSON.stringify(r)}`);
    return r.finalPrescription;
  }

  const toRow = (fp: FinalPrescriptionV2, athleteId: string) => ({
    id: fp.id,
    decision_id: fp.decisionId,
    athlete_id: athleteId,
    plan_version_id: fp.planVersionId ?? null,
    planned_prescription_id: fp.plannedPrescriptionId ?? null,
    active_session_origin: fp.activeSessionOrigin,
    reconciliation_action: fp.reconciliationAction,
    adaptation_rule_ids: fp.adaptationRuleIds,
    schema_version: fp.schemaVersion,
    catalog_version: fp.catalogVersion,
    structure: fp.structure,
  });

  const persist = (athleteId: string, decision: unknown, outcome: unknown, healthFlag: unknown = null) =>
    admin.rpc("persist_daily_run_v2", { p_athlete_id: athleteId, p_health_flag: healthFlag, p_decision_row: decision, p_final_prescription_outcome: outcome });

  async function decisionStatus(decisionId: string) {
    const { data } = await admin.from("decisions").select("final_prescription_status, final_prescription_status_code, final_prescription_status_detail").eq("id", decisionId).maybeSingle();
    return data;
  }
  async function finalsOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("*").eq("decision_id", decisionId);
    return data!;
  }

  // One seeded athlete with a V2 plan for the whole file; every scenario uses its own day.
  let shared: Promise<Fixture> | null = null;
  const fixture = () => (shared ??= seed("5c.2 shared V2 plan"));

  beforeAll(() => {
    assertLocalDbReady();
    admin = createTestClient();
  });

  describe("persist_daily_run_v2 — valid outcomes", () => {
    let f: Fixture;
    let c: Checkin;
    beforeAll(async () => {
      f = await fixture();
      c = await checkin(f.athleteId, STRENGTH_DAY);
    });

    it("created (KEEP with lineage): one decision, status created, exactly one final prescription stored verbatim", async () => {
      const decisionId = randomUUID();
      const fp = keep(f, decisionId);
      const { data, error } = await persist(f.athleteId, decisionRow(decisionId, f.athleteId, STRENGTH_DAY, "KEEP", c), { status: "created", final_prescription: toRow(fp, f.athleteId) });
      expect(error).toBeNull();
      expect(data).toEqual({ decision_id: decisionId, health_flag_id: null, final_prescription_id: fp.id, final_prescription_status: "created" });

      expect(await decisionStatus(decisionId)).toEqual({ final_prescription_status: "created", final_prescription_status_code: null, final_prescription_status_detail: null });
      const finals = await finalsOf(decisionId);
      expect(finals).toHaveLength(1);
      expect(finals[0]).toMatchObject({
        id: fp.id,
        decision_id: decisionId,
        athlete_id: f.athleteId,
        plan_version_id: f.planVersionId,
        planned_prescription_id: f.strengthPlanned.id,
        active_session_origin: "generated",
        reconciliation_action: "keep",
        adaptation_rule_ids: [],
        schema_version: "v2",
        catalog_version: "session-model-v2.5",
      });
      // Exact document: the planned structure, same ids, nothing recomputed by SQL.
      expect(finals[0]!.structure).toEqual(f.strengthPlanned.structure);
    });

    it("not_required (REST): decision + health flag, no final prescription; the status survives a re-read", async () => {
      const decisionId = randomUUID();
      const { data, error } = await persist(
        f.athleteId,
        decisionRow(decisionId, f.athleteId, "2026-10-10", "REST", null),
        { status: "not_required" },
        { flag_type: "illness", flag_date: "2026-10-10", description: "UX-11A.5c.2 test" }
      );
      expect(error).toBeNull();
      expect(data).toMatchObject({ decision_id: decisionId, final_prescription_id: null, final_prescription_status: "not_required" });
      expect((data as { health_flag_id: string | null }).health_flag_id).not.toBeNull();
      expect(await decisionStatus(decisionId)).toEqual({ final_prescription_status: "not_required", final_prescription_status_code: null, final_prescription_status_detail: null });
      expect(await finalsOf(decisionId)).toEqual([]);
    });

    it.each<[string, Decision, Record<string, unknown> | null]>([
      ["final_prescription_no_lineage", "KEEP", { reason: "no_planned_session" }],
      ["final_prescription_adaptation_not_defined", "MODIFY", { reason: "upward_modify_not_supported" }],
      ["final_prescription_adaptation_not_defined", "REPLACE", { reason: "replace_not_supported" }],
      ["final_prescription_catalog_mismatch", "KEEP", null],
    ])("blocked %s (%s): decision persisted, durable code and detail, zero final prescription", async (code, decision, detail) => {
      const decisionId = randomUUID();
      const { data, error } = await persist(f.athleteId, decisionRow(decisionId, f.athleteId, "2026-10-11", decision, null), { status: "blocked", code, ...(detail ? { detail } : {}) });
      expect(error).toBeNull();
      expect(data).toMatchObject({ decision_id: decisionId, final_prescription_id: null, final_prescription_status: "blocked" });
      expect(await decisionStatus(decisionId)).toEqual({ final_prescription_status: "blocked", final_prescription_status_code: code, final_prescription_status_detail: detail });
      expect(await finalsOf(decisionId)).toEqual([]);
    });
  });

  describe("persist_daily_run_v2 — incoherent payloads are refused, nothing is written", () => {
    let f: Fixture;
    let c: Checkin;
    beforeAll(async () => {
      f = await fixture();
      c = await checkin(f.athleteId, REFUSAL_DAY);
    });

    type Case = [string, string, (decisionId: string) => { decision?: Decision; outcome: unknown }];
    const cases: Case[] = [
      ["created without final prescription", "requires exactly one final prescription", () => ({ outcome: { status: "created" } })],
      ["created with a collection of final prescriptions", "requires exactly one final prescription", (d) => ({ outcome: { status: "created", final_prescription: [toRow(keep(f, d), f.athleteId), toRow(keep(f, d), f.athleteId)] } })],
      ["created with a code", "created carries no code", (d) => ({ outcome: { status: "created", code: "x", final_prescription: toRow(keep(f, d), f.athleteId) } })],
      ["blocked with a final prescription", "blocked never carries a final prescription", (d) => ({ outcome: { status: "blocked", code: "final_prescription_no_lineage", final_prescription: toRow(keep(f, d), f.athleteId) } })],
      ["blocked without code", "blocked requires a code", () => ({ outcome: { status: "blocked" } })],
      ["not_required with a final prescription", "not_required carries no final prescription", (d) => ({ decision: "REST", outcome: { status: "not_required", final_prescription: toRow(keep(f, d), f.athleteId) } })],
      ["not_required for a non-REST decision", "only valid for a REST decision", () => ({ decision: "KEEP", outcome: { status: "not_required" } })],
      ["a NULL status (reserved to V1 / history)", "unknown final prescription status", () => ({ outcome: { status: null } })],
      ["no outcome at all", "p_final_prescription_outcome is required", () => ({ outcome: null })],
      ["a final schema other than v2", "schema_version must be v2", (d) => ({ outcome: { status: "created", final_prescription: { ...toRow(keep(f, d), f.athleteId), schema_version: "v1" } } })],
      ["catalog_version different from structure.catalog.aggregate", "must equal structure.catalog.aggregate", (d) => ({ outcome: { status: "created", final_prescription: { ...toRow(keep(f, d), f.athleteId), catalog_version: "session-model-v2.4" } } })],
      ["a final prescription of another athlete", "athlete_id does not match", (d) => ({ outcome: { status: "created", final_prescription: { ...toRow(keep(f, d), f.athleteId), athlete_id: randomUUID() } } })],
      ["a final prescription of another decision", "decision_id must be the decision persisted by this call", () => ({ outcome: { status: "created", final_prescription: toRow(keep(f, randomUUID()), f.athleteId) } })],
      ["keep without planned_prescription_id", "requires planned_prescription_id", (d) => ({ outcome: { status: "created", final_prescription: { ...toRow(keep(f, d), f.athleteId), planned_prescription_id: null } } })],
      ["an action that does not match the decision", "does not match decision", (d) => ({ decision: "MODIFY", outcome: { status: "created", final_prescription: toRow(keep(f, d), f.athleteId) } })],
    ];

    it.each(cases)("%s → %s", async (_label, message, build) => {
      const decisionId = randomUUID();
      const { decision = "KEEP", outcome } = build(decisionId);
      const { error } = await persist(f.athleteId, decisionRow(decisionId, f.athleteId, REFUSAL_DAY, decision, c), outcome, { flag_type: "other", flag_date: REFUSAL_DAY, description: "must roll back" });
      expect(error?.message).toContain(message);
      expect(await decisionStatus(decisionId)).toBeNull();
      expect(await finalsOf(decisionId)).toEqual([]);
    });

    it("a failure AFTER the health flag and decision inserts (table constraint on the final prescription) rolls everything back", async () => {
      const decisionId = randomUUID();
      // keep + adaptation rules violates decision_final_prescriptions_adaptation_rule_ids_matches_action at insert time.
      const row = { ...toRow(keep(f, decisionId), f.athleteId), adaptation_rule_ids: ["C3.3"] };
      const { error } = await persist(f.athleteId, decisionRow(decisionId, f.athleteId, REFUSAL_DAY, "KEEP", c), { status: "created", final_prescription: row }, {
        flag_type: "pain_persistent",
        flag_date: REFUSAL_DAY,
        description: "must roll back",
      });
      expect(error?.message).toContain("decision_final_prescriptions_adaptation_rule_ids_matches_action");
      expect(await decisionStatus(decisionId)).toBeNull();
      expect(await finalsOf(decisionId)).toEqual([]);
      const { data: flags } = await admin.from("health_flags").select("id").eq("athlete_id", f.athleteId).in("flag_type", ["other", "pain_persistent"]);
      expect(flags).toEqual([]);
    });
  });

  it("unique (decision_id): a second final prescription for the same decision is refused, the first stays intact", async () => {
    const f = await fixture();
    const c = await checkin(f.athleteId, UNIQUE_DAY);
    const decisionId = randomUUID();
    const fp = keep(f, decisionId);
    expect((await persist(f.athleteId, decisionRow(decisionId, f.athleteId, UNIQUE_DAY, "KEEP", c), { status: "created", final_prescription: toRow(fp, f.athleteId) })).error).toBeNull();
    expect(() =>
      execLocalSql(
        `insert into public.decision_final_prescriptions (decision_id, athlete_id, active_session_origin, reconciliation_action, schema_version, catalog_version, structure)
         values ('${decisionId}', '${f.athleteId}', 'no_canonical_plan', 'keep', 'v2', 'x', '{}'::jsonb);`
      )
    ).toThrow(/decision_final_prescriptions_unique_decision/);
    const finals = await finalsOf(decisionId);
    expect(finals.map((r) => r.id)).toEqual([fp.id]);
  });

  describe("record_session_execution — only the current decision's final prescription is executable", () => {
    let f: Fixture;
    beforeAll(async () => {
      f = await fixture();
    });

    const record = async (athleteId: string, payload: unknown) => {
      const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
      if (error) throw new Error(`record_session_execution raised: ${error.message}`);
      return data as { status: string; code?: string };
    };
    function start(finalPrescriptionId: string, day = CURRENT_DAY) {
      const id = randomUUID();
      return {
        id,
        payload: {
          execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: finalPrescriptionId },
          events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }],
        },
      };
    }
    const abandon = (executionId: string, day = CURRENT_DAY) =>
      record(f.athleteId, { events: [{ id: randomUUID(), execution_id: executionId, event_type: "abandoned", occurred_at: `${day}T17:30:00Z` }] });

    it("D1/F1 current → executable; D2/F2 persisted → F1 final_prescription_not_current, F2 executable; check-in edited → F2 not current", async () => {
      const c = await checkin(f.athleteId, CURRENT_DAY);

      const d1 = randomUUID();
      const f1 = keep(f, d1);
      expect((await persist(f.athleteId, decisionRow(d1, f.athleteId, CURRENT_DAY, "KEEP", c), { status: "created", final_prescription: toRow(f1, f.athleteId) })).error).toBeNull();
      const e1 = start(f1.id);
      expect(await record(f.athleteId, e1.payload)).toMatchObject({ status: "ok" });
      expect(await abandon(e1.id)).toMatchObject({ status: "ok" });

      // A new daily run (append-only): D2 becomes the day's current decision.
      const d2 = randomUUID();
      const f2 = keep(f, d2);
      expect((await persist(f.athleteId, decisionRow(d2, f.athleteId, CURRENT_DAY, "KEEP", c), { status: "created", final_prescription: toRow(f2, f.athleteId) })).error).toBeNull();

      expect(await record(f.athleteId, start(f1.id).payload)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
      const e2 = start(f2.id);
      expect(await record(f.athleteId, e2.payload)).toMatchObject({ status: "ok" });
      expect(await abandon(e2.id)).toMatchObject({ status: "ok" });

      // The decision is no longer current for its inputs (daily_decision_currency): F2 is no longer executable.
      const { error } = await admin.from("daily_checkins").update({ updated_at: new Date(Date.now() + 60_000).toISOString() }).eq("id", c.id);
      expect(error).toBeNull();
      expect(await record(f.athleteId, start(f2.id).payload)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
    });

    it("a later REST (not_required) or blocked decision supersedes an earlier final prescription", async () => {
      const day = "2026-10-15";
      const c = await checkin(f.athleteId, day);
      const d1 = randomUUID();
      const f1 = keep(f, d1);
      expect((await persist(f.athleteId, decisionRow(d1, f.athleteId, day, "KEEP", c), { status: "created", final_prescription: toRow(f1, f.athleteId) })).error).toBeNull();
      expect((await persist(f.athleteId, decisionRow(randomUUID(), f.athleteId, day, "REST", c), { status: "not_required" })).error).toBeNull();
      expect(await record(f.athleteId, start(f1.id, day).payload)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
    });

    it("a final prescription whose decision was not written with status created is not executable (no fallback)", async () => {
      const day = "2026-10-16";
      const c = await checkin(f.athleteId, day);
      const legacyDecision = randomUUID();
      const legacyFinal = randomUUID();
      execLocalSql(
        `insert into public.decisions (id, athlete_id, decision_date, final_session, reason, engine_version, source_checkin_id, source_checkin_updated_at)
           values ('${legacyDecision}', '${f.athleteId}', '${day}', 'STRENGTH_A', 'legacy fixture', 'test', '${c.id}', '${c.updated_at}');
         insert into public.decision_final_prescriptions (id, decision_id, athlete_id, active_session_origin, reconciliation_action, schema_version, catalog_version, structure)
           values ('${legacyFinal}', '${legacyDecision}', '${f.athleteId}', 'no_canonical_plan', 'keep', 'v2', 'x', '{"schemaVersion":"v2","blocks":[]}'::jsonb);`
      );
      expect(await record(f.athleteId, start(legacyFinal, day).payload)).toEqual({ status: "rejected", code: "not_executable", target: "execution" });
    });
  });

  describe("RLS and grants", () => {
    it("the rider reads their own final prescription and status; another rider sees nothing; no direct write for anyone", async () => {
      const f = await fixture();
      const other = await createTestAthlete(admin, "5c.2 RLS other");
      const c = await checkin(f.athleteId, RLS_DAY);
      const decisionId = randomUUID();
      const fp = keep(f, decisionId);
      expect((await persist(f.athleteId, decisionRow(decisionId, f.athleteId, RLS_DAY, "KEEP", c), { status: "created", final_prescription: toRow(fp, f.athleteId) })).error).toBeNull();

      const owner = await getAthleteAuthClient(f.athleteId);
      const stranger = await getAthleteAuthClient(other.athleteId);
      expect((await owner.from("decision_final_prescriptions").select("id").eq("decision_id", decisionId)).data).toEqual([{ id: fp.id }]);
      expect((await owner.from("decisions").select("final_prescription_status").eq("id", decisionId)).data).toEqual([{ final_prescription_status: "created" }]);
      expect((await stranger.from("decision_final_prescriptions").select("id").eq("decision_id", decisionId)).data).toEqual([]);
      expect((await stranger.from("decisions").select("id").eq("id", decisionId)).data).toEqual([]);

      const directRow = { ...toRow(keep(f, randomUUID()), f.athleteId) };
      expect((await owner.from("decision_final_prescriptions").insert(directRow)).error).not.toBeNull();
      expect((await admin.from("decision_final_prescriptions").insert(directRow)).error).not.toBeNull();
      // The V2 RPC is server-only: an authenticated rider cannot call it.
      const { error } = await owner.rpc("persist_daily_run_v2", { p_athlete_id: f.athleteId, p_health_flag: null, p_decision_row: {}, p_final_prescription_outcome: { status: "not_required" } });
      expect(error).not.toBeNull();
    });

    it("grants: execute on persist_daily_run_v2 for service_role only; decision_final_prescriptions is SELECT-only for API roles", () => {
      const routine = execLocalSql(
        `select grantee from information_schema.role_routine_grants where routine_schema = 'public' and routine_name = 'persist_daily_run_v2' order by grantee;`
      ).trim().split("\n");
      expect(routine).toEqual(["postgres", "service_role"]);
      const table = execLocalSql(
        `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'decision_final_prescriptions' and grantee in ('anon', 'authenticated', 'service_role') group by grantee order by grantee;`
      ).trim().split("\n");
      expect(table).toEqual(["authenticated:SELECT", "service_role:SELECT"]);
      const definer = execLocalSql(`select prosecdef || ':' || array_to_string(proconfig, ';') from pg_proc where proname = 'persist_daily_run_v2';`).trim();
      expect(definer).toBe("true:search_path=public, pg_temp");
    });
  });
});
