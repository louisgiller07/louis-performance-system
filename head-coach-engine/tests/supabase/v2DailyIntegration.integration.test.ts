/**
 * UX-11A.5c.3 — V2 daily integration, end to end on the real local Supabase:
 * V2 plan generated, accepted and projected through the real code, check-in,
 * then the real runDailyFor (real M1) → persist_daily_run_v2. Local only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sportFingerprint } from "planning-engine/session-model-v2";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import type { GenerateTrainingPlanVersionPayloadV2 } from "../../src/generation/v2/planV2PersistencePayload.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import { UnsupportedPlanPrescriptionSchemaError } from "../../src/supabase/dailyV2/dailyPrescriptionModel.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const TODAY = "2026-10-05";
const GENERATED_ON = "2026-10-04"; // BUG-V2-3 — a plan starts the day after its generation: generated the eve, its first day is TODAY
const WINDOW_END = "2026-10-18";
// Development plan (all-day availability): DH 10-05/06/12/13, LOWER 10-07/14, UPPER 10-08/15, AEROBIC 10-09/16, nothing 10-10/11/17/18.
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const LEGS_RED: CheckinFixture = { leg_fatigue: 9 };

describe.skipIf(!INTEGRATION_ENABLED)("UX-11A.5c.3 — V2 daily integration (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function athlete(name: string): Promise<string> {
    const { athleteId } = await createTestAthlete(admin, name);
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
    return athleteId;
  }

  /** A real V2 plan, accepted and projected; `tamper` alters the RPC payload (catalogue / schema scenarios only). */
  async function withV2Plan(name: string, tamper?: (p: GenerateTrainingPlanVersionPayloadV2) => GenerateTrainingPlanVersionPayloadV2) {
    const athleteId = await athlete(name);
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON },
      { buildPlanInputSnapshotV2, callRpc: (c, p) => generateTrainingPlanVersionRpcV2(c, tamper ? tamper(p) : p), mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("expected a persisted V2 plan");
    const accepted = await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, TODAY, WINDOW_END);
    expect(accepted.warnings).toEqual([]);
    return { athleteId, planVersionId: persisted.planVersionId };
  }

  async function decisionsOn(athleteId: string, day: string) {
    const { data } = await admin
      .from("decisions")
      .select("id, daily_plan, final_prescription_status, final_prescription_status_code, final_prescription_status_detail")
      .eq("athlete_id", athleteId)
      .eq("decision_date", day)
      .order("created_at");
    return data!;
  }
  async function finalsOf(decisionId: string) {
    const { data } = await admin.from("decision_final_prescriptions").select("*").eq("decision_id", decisionId);
    return data!;
  }
  async function plannedOn(planVersionId: string, day: string) {
    const { data: session } = await admin.from("training_plan_generated_sessions").select("id, kind").eq("plan_version_id", planVersionId).eq("date", day).single();
    const { data: planned } = await admin.from("training_plan_planned_prescriptions").select("id, structure").eq("generated_plan_session_id", session!.id).single();
    return { kind: session!.kind as string, id: planned!.id as string, structure: planned!.structure };
  }
  const record = async (athleteId: string, payload: unknown) => {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as { status: string; code?: string };
  };
  function start(finalPrescriptionId: string, day: string) {
    const id = randomUUID();
    return {
      id,
      payload: {
        execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: finalPrescriptionId },
        events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }],
      },
    };
  }
  const abandon = (athleteId: string, executionId: string, day: string) =>
    record(athleteId, { events: [{ id: randomUUID(), execution_id: executionId, event_type: "abandoned", occurred_at: `${day}T17:30:00Z` }] });
  const updateCheckin = async (athleteId: string, day: string, fields: CheckinFixture) => {
    const { error } = await admin.from("daily_checkins").update(fields).eq("athlete_id", athleteId).eq("checkin_date", day);
    expect(error).toBeNull();
  };

  describe("one V2 athlete: KEEP, no lineage, MODIFY, REPLACE, second run", () => {
    let a: { athleteId: string; planVersionId: string };
    beforeAll(async () => {
      a = await withV2Plan("5c.3 V2 daily A");
    });

    it.each([
      ["Force", "2026-10-07", "STRENGTH_LOWER"],
      ["DH", "2026-10-05", "DH_TECHNICAL"],
      ["endurance", "2026-10-09", "AEROBIC_BASE"],
    ])("KEEP %s: one decision, status created, the planned prescription stored verbatim (same ids, same fingerprint)", async (_label, day, kind) => {
      await insertCheckin(admin, a.athleteId, day);
      const result = await runDailyFor(admin, a.athleteId, day);
      expect(result.dailyPlan.decision).toBe("KEEP");
      expect(result.finalPrescriptionStatus).toBe("created");

      const decisions = await decisionsOn(a.athleteId, day);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ id: result.persistence.decision_id, final_prescription_status: "created", final_prescription_status_code: null, final_prescription_status_detail: null });
      const planned = await plannedOn(a.planVersionId, day);
      expect(planned.kind).toBe(kind);
      const finals = await finalsOf(decisions[0]!.id);
      expect(finals).toHaveLength(1);
      expect(finals[0]).toMatchObject({ id: result.finalPrescription!.id, planned_prescription_id: planned.id, plan_version_id: a.planVersionId, reconciliation_action: "keep", active_session_origin: "generated" });
      expect(finals[0]!.structure).toEqual(planned.structure);
      expect(sportFingerprint(finals[0]!.structure)).toBe(sportFingerprint(planned.structure));
      // Not rendered by the web yet: the V1 reader stays fail-closed.
      expect(result.executablePrescription).toBeNull();
      expect(result.executablePrescriptionStatus).toBe("unsupported_schema_version");
    });

    it("KEEP on a V2 plan day without planned session: V2 path, blocked final_prescription_no_lineage, nothing invented", async () => {
      const day = "2026-10-10";
      await insertCheckin(admin, a.athleteId, day);
      const result = await runDailyFor(admin, a.athleteId, day);
      expect(result.dailyPlan.decision).toBe("KEEP");
      expect(result.dailyPlan.final_session.kind).toBe("RECOVERY_ACTIVE");
      const [decision] = await decisionsOn(a.athleteId, day);
      expect(decision).toMatchObject({ final_prescription_status: "blocked", final_prescription_status_code: "final_prescription_no_lineage", final_prescription_status_detail: { reason: "no_planned_session" } });
      expect(await finalsOf(decision!.id)).toEqual([]);
      expect(result).not.toHaveProperty("finalPrescription");
    });

    it("A04 — MODIFY (systemic RED on a MODERATE endurance day): created, the same protocol and activities, 45 min, lineage to the planned prescription", async () => {
      const day = "2026-10-16"; // build week (BUG-V2-2): AEROBIC_BASE MODERATE
      await insertCheckin(admin, a.athleteId, day, SYSTEMIC_RED);
      const result = await runDailyFor(admin, a.athleteId, day);
      expect(result.dailyPlan.decision).toBe("MODIFY");
      const [decision] = await decisionsOn(a.athleteId, day);
      expect((decision!.daily_plan as { decision: string }).decision).toBe("MODIFY");
      expect(decision).toMatchObject({ final_prescription_status: "created", final_prescription_status_code: null, final_prescription_status_detail: null });
      const planned = await plannedOn(a.planVersionId, day);
      const [final] = await finalsOf(decision!.id);
      expect(final).toMatchObject({ reconciliation_action: "modify", active_session_origin: "generated", planned_prescription_id: planned.id, plan_version_id: a.planVersionId, adaptation_rule_ids: ["v2.modify.endurance_light_duration"] });
      const st = final!.structure as { protocolId: string; activitySelection: unknown; blocks: { durationMinutes?: { min: number } }[] };
      expect(st.protocolId).toBe((planned.structure as { protocolId: string }).protocolId);
      expect(st.activitySelection).toEqual((planned.structure as { activitySelection: unknown }).activitySelection);
      expect(st.blocks.reduce((n, b) => n + (b.durationMinutes?.min ?? 0), 0)).toBe(45);
      // Executable: the current final prescription starts.
      expect(await record(a.athleteId, start(final!.id, day).payload)).toMatchObject({ status: "ok" });
    });

    it("A04 — REPLACE (legs RED on a lower-body day, M1 C3.6 → STRENGTH_UPPER): created, a complete upper-body Force session, no planned prescription lineage", async () => {
      const day = "2026-10-14";
      await insertCheckin(admin, a.athleteId, day, LEGS_RED);
      const result = await runDailyFor(admin, a.athleteId, day);
      expect(result.dailyPlan.decision).toBe("REPLACE");
      expect(result.dailyPlan.final_session.kind).toBe("STRENGTH_UPPER");
      const [decision] = await decisionsOn(a.athleteId, day);
      expect((decision!.daily_plan as { decision: string }).decision).toBe("REPLACE");
      expect(decision).toMatchObject({ final_prescription_status: "created", final_prescription_status_code: null });
      const [final] = await finalsOf(decision!.id);
      expect(final).toMatchObject({ reconciliation_action: "replace", active_session_origin: "generated", planned_prescription_id: null, plan_version_id: a.planVersionId, adaptation_rule_ids: ["v2.replace.strength"] });
      const st = final!.structure as { sessionKind: string; templateId: string; blocks: { role: string; items: { sets: number; rpeTarget?: unknown; restSeconds?: unknown }[] }[] };
      expect([st.sessionKind, st.templateId]).toEqual(["STRENGTH_UPPER", "strength_upper_intermediate_v1"]);
      const workItems = st.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
      expect(workItems.length).toBeGreaterThan(0);
      for (const i of workItems) expect(i.sets > 0 && i.rpeTarget !== undefined && i.restSeconds !== undefined).toBe(true);
      expect(await record(a.athleteId, start(final!.id, day).payload)).toMatchObject({ status: "ok" });
    });

    it("second run, case A (KEEP again): D2/F2 current; F1 final_prescription_not_current, F2 executable", async () => {
      const day = "2026-10-12";
      await insertCheckin(admin, a.athleteId, day);
      const run1 = await runDailyFor(admin, a.athleteId, day);
      const e1 = start(run1.finalPrescription!.id, day);
      expect(await record(a.athleteId, e1.payload)).toMatchObject({ status: "ok" });
      expect(await abandon(a.athleteId, e1.id, day)).toMatchObject({ status: "ok" });

      const run2 = await runDailyFor(admin, a.athleteId, day);
      expect(run2.finalPrescriptionStatus).toBe("created");
      expect(run2.persistence.decision_id).not.toBe(run1.persistence.decision_id);
      expect(await decisionsOn(a.athleteId, day)).toHaveLength(2);

      expect(await record(a.athleteId, start(run1.finalPrescription!.id, day).payload)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
      const e2 = start(run2.finalPrescription!.id, day);
      expect(await record(a.athleteId, e2.payload)).toMatchObject({ status: "ok" });
      expect(await abandon(a.athleteId, e2.id, day)).toMatchObject({ status: "ok" });
    });

    it("second run, case C (now MODIFY → created F2): F1 is no longer executable, F2 is", async () => {
      const day = "2026-10-15";
      await insertCheckin(admin, a.athleteId, day);
      const run1 = await runDailyFor(admin, a.athleteId, day);
      expect(run1.finalPrescriptionStatus).toBe("created");
      await updateCheckin(a.athleteId, day, SYSTEMIC_RED);
      const run2 = await runDailyFor(admin, a.athleteId, day);
      expect(run2.dailyPlan.decision).toBe("MODIFY");
      expect(run2.finalPrescriptionStatus).toBe("created");
      expect(run2.finalPrescription!.reconciliationAction).toBe("modify");
      expect(await record(a.athleteId, start(run1.finalPrescription!.id, day).payload)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
      expect(await record(a.athleteId, start(run2.finalPrescription!.id, day).payload)).toMatchObject({ status: "ok" });
    });
  });

  it("REST (and second run case B): run 1 KEEP created; check-in now unsafe → run 2 REST, not_required, zero final row, health flag; F1 not current", async () => {
    const b = await withV2Plan("5c.3 V2 daily B");
    const day = "2026-10-06";
    await insertCheckin(admin, b.athleteId, day);
    const run1 = await runDailyFor(admin, b.athleteId, day);
    expect(run1.finalPrescriptionStatus).toBe("created");

    await updateCheckin(b.athleteId, day, { suspected_concussion: true });
    const run2 = await runDailyFor(admin, b.athleteId, day);
    expect(run2.dailyPlan.decision).toBe("REST");
    expect(run2.finalPrescriptionStatus).toBe("not_required");
    expect(run2.persistence.health_flag_id).not.toBeNull();

    // Durable after a DB re-read: decision REST + not_required + zero final row.
    const decisions = await decisionsOn(b.athleteId, day);
    const rest = decisions.find((d) => d.id === run2.persistence.decision_id)!;
    expect((rest.daily_plan as { decision: string }).decision).toBe("REST");
    expect(rest).toMatchObject({ final_prescription_status: "not_required", final_prescription_status_code: null });
    expect(await finalsOf(rest.id)).toEqual([]);
    expect(await record(b.athleteId, start(run1.finalPrescription!.id, day).payload)).toEqual({ status: "rejected", code: "final_prescription_not_current", target: "execution" });
  });

  it("catalogue mismatch: a planned prescription from an older aggregate the runtime cannot validate → blocked final_prescription_catalog_mismatch, no fallback", async () => {
    const c = await withV2Plan("5c.3 V2 daily catalogue", (p) => {
      const lowerSession = p.sessions.find((s) => s.date === "2026-10-07")!;
      const prescription = p.plannedPrescriptions.find((x) => x.generatedPlanSessionId === lowerSession.id)!;
      const structure = JSON.parse(JSON.stringify(prescription.structure));
      structure.catalog.aggregate = "session-model-v2.0";
      structure.blocks.find((b: { role: string }) => b.role === "main").items[0].exerciseId = "exercise_removed_since_v2_0";
      prescription.structure = structure;
      prescription.catalogVersion = "session-model-v2.0";
      return p;
    });
    const day = "2026-10-07";
    await insertCheckin(admin, c.athleteId, day);
    const result = await runDailyFor(admin, c.athleteId, day);
    expect(result.dailyPlan.decision).toBe("KEEP");
    const [decision] = await decisionsOn(c.athleteId, day);
    expect(decision).toMatchObject({
      final_prescription_status: "blocked",
      final_prescription_status_code: "final_prescription_catalog_mismatch",
      final_prescription_status_detail: { plannedAggregate: "session-model-v2.0", runtimeAggregate: "session-model-v2.6" },
    });
    expect(await finalsOf(decision!.id)).toEqual([]);
  });

  it("unknown plan schema (v999): fail-closed before any daily write", async () => {
    const d = await withV2Plan("5c.3 V2 daily v999", (p) => ({ ...p, version: { ...p.version, prescriptionSchemaVersion: "v999" as "v2" } }));
    const day = "2026-10-07";
    await insertCheckin(admin, d.athleteId, day);
    await expect(runDailyFor(admin, d.athleteId, day)).rejects.toThrow(UnsupportedPlanPrescriptionSchemaError);
    expect(await decisionsOn(d.athleteId, day)).toEqual([]);
  });

  describe("V1 unchanged", () => {
    it("no plan: historical V1 path, no V2 field, NULL status", async () => {
      const athleteId = await athlete("5c.3 V1 no plan");
      await insertCheckin(admin, athleteId, "2026-10-07");
      const result = await runDailyFor(admin, athleteId, "2026-10-07");
      for (const key of ["finalPrescriptionStatus", "finalPrescriptionStatusCode", "finalPrescriptionStatusDetail", "finalPrescription", "plannedSessionObservation"]) expect(result).not.toHaveProperty(key);
      const [decision] = await decisionsOn(athleteId, "2026-10-07");
      expect(decision).toMatchObject({ final_prescription_status: null, final_prescription_status_code: null, final_prescription_status_detail: null });
      expect(await finalsOf(decision!.id)).toEqual([]);
    });

    it("v1 plan: historical V1 path (legacy executable prescription lookup), no V2 field, NULL status", async () => {
      const athleteId = await athlete("5c.3 V1 plan");
      const generated = await generateAndPersistTrainingPlan({ client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: GENERATED_ON });
      await acceptTrainingPlanVersion(admin, athleteId, generated.planVersionId, TODAY, WINDOW_END);
      const day = "2026-10-07";
      await insertCheckin(admin, athleteId, day);
      const result = await runDailyFor(admin, athleteId, day);
      expect(result).not.toHaveProperty("finalPrescriptionStatus");
      expect(result.executablePrescriptionStatus).not.toBe("unsupported_schema_version");
      const [decision] = await decisionsOn(athleteId, day);
      expect(decision).toMatchObject({ final_prescription_status: null });
      expect(await finalsOf(decision!.id)).toEqual([]);
    });
  });
});
