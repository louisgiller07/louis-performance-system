/**
 * SPORT-SAFE-01 (HPM 2026-10-18) — the daily adaptations through the real paths (local Supabase): a real V2 plan,
 * accepted and projected, a check-in, runDailyFor (production daily path, PHYS off). Compares the real prescriptions
 * (type, duration, intensity, passes, M1's protection and monitoring texts), not only statuses.
 *
 * Anomaly 2 (corrected, ADR A04 §6): M1's LIGHT on an endurance session already at the policy's LIGHT duration (45 min,
 * fixed protocol RPE) is refused (`modify_not_supported`), never the planned dose shown as lighter; a 60-min session is
 * really shortened to 45 min. SPORT-SAFE-01R: the refusal is A04's outcome, so A10 does not evaluate it (`docs/04`).
 * Anomaly 1 (characterized, not changed): a knee pain 4/10 on a DH day stays M1's PAIN_NON_SAFETY adaptation (DH LIGHT,
 * the planned window, 4 passes) with its protection and monitoring texts; 6/10 is Safety (REST + health flag).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sportFingerprint } from "planning-engine/session-model-v2";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

const GENERATED_ON = "2026-10-04";
const FIRST_DAY = "2026-10-05";
const WINDOW_END = "2026-10-25";
const ENDURANCE_45 = "2026-10-16";
const ENDURANCE_60 = "2026-10-23";
const DH_DAY = "2026-10-12";
const REST_DAY = "2026-10-10";

const LIGHT_FATIGUE: CheckinFixture = { sleep_hours: 6.5, sleep_quality: 6, energy: 6 };
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const LEGS_RED: CheckinFixture = { leg_fatigue: 9 };
const KNEE_PAIN_4: CheckinFixture = { pain: true, pain_intensity: 4, pain_location_code: "knee_R" };
const KNEE_PAIN_6: CheckinFixture = { pain: true, pain_intensity: 6, pain_location_code: "knee_R" };

type Block = { role: string; durationMinutes?: { min: number; max: number }; rpeTarget?: { min: number; max: number }; items?: { drillId?: string; measure?: { type: string; count?: number } }[] };
type Structure = { blocks: Block[] };
const mainOf = (s: Structure) => s.blocks.filter((b) => b.role === "main");
const minutesOf = (s: Structure) => s.blocks.reduce((n, b) => n + (b.durationMinutes?.min ?? 0), 0);
const passesOf = (s: Structure) => mainOf(s).flatMap((b) => b.items ?? []).reduce((n, i) => n + (i.measure?.type === "pass" ? (i.measure.count ?? 0) : 0), 0);

describe.skipIf(!INTEGRATION_ENABLED)("SPORT-SAFE-01 — daily adaptations, real prescriptions (local Supabase)", () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  /** SPORT-VALIDATION-01's exploration rider: intermediate, dumbbells + bench, flow + bermed trails, all-day availability. */
  async function rider(name: string) {
    const { athleteId } = await createTestAthlete(admin, `SPORT-SAFE-01 ${name}`);
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 3, today: GENERATED_ON },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("expected a persisted V2 plan");
    const accepted = await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, FIRST_DAY, WINDOW_END);
    expect(accepted.warnings).toEqual([]);
    return { athleteId, planVersionId: persisted.planVersionId };
  }
  async function plannedOn(planVersionId: string, day: string) {
    const { data: session } = await admin.from("training_plan_generated_sessions").select("id, kind, load_profile, duration_min").eq("plan_version_id", planVersionId).eq("date", day).single();
    const { data: planned } = await admin.from("training_plan_planned_prescriptions").select("id, structure").eq("generated_plan_session_id", session!.id).single();
    return { kind: session!.kind as string, load: session!.load_profile as string, durationMin: session!.duration_min as number, structure: planned!.structure as Structure };
  }
  async function decisionOn(athleteId: string, day: string) {
    const { data } = await admin.from("decisions").select("id, final_prescription_status, final_prescription_status_code, final_prescription_status_detail").eq("athlete_id", athleteId).eq("decision_date", day);
    expect(data).toHaveLength(1);
    const { data: finals } = await admin.from("decision_final_prescriptions").select("structure, adaptation_rule_ids, reconciliation_action").eq("decision_id", data![0]!.id);
    return { ...data![0]!, finals: finals! };
  }
  async function day(name: string, date: string, checkin: CheckinFixture) {
    const r = await rider(name);
    await insertCheckin(admin, r.athleteId, date, checkin);
    const result = await runDailyFor(admin, r.athleteId, date);
    return { ...r, result, plan: result.dailyPlan, decision: await decisionOn(r.athleteId, date), planned: await plannedOn(r.planVersionId, date).catch(() => null) };
  }
  const rules = (plan: { triggered_rules: { rule_id: string }[] }) => plan.triggered_rules.map((t) => t.rule_id);

  it("the plan: endurance MODERATE 45 (build), endurance MODERATE 60 (build_plus), DH MODERATE 90 with 6 passes, nothing planned on the rest day", async () => {
    const r = await rider("plan");
    const e45 = await plannedOn(r.planVersionId, ENDURANCE_45);
    const e60 = await plannedOn(r.planVersionId, ENDURANCE_60);
    const dh = await plannedOn(r.planVersionId, DH_DAY);
    expect([e45.kind, e45.load, e45.durationMin, minutesOf(e45.structure)]).toEqual(["AEROBIC_BASE", "MODERATE", 45, 45]);
    expect(mainOf(e45.structure).map((b) => [b.durationMinutes, b.rpeTarget])).toEqual([[{ min: 30, max: 30 }, { min: 3, max: 4 }]]);
    expect([e60.kind, e60.load, e60.durationMin, minutesOf(e60.structure)]).toEqual(["AEROBIC_BASE", "MODERATE", 60, 60]);
    expect([dh.kind, dh.load, dh.durationMin, passesOf(dh.structure)]).toEqual(["DH_TECHNICAL", "MODERATE", 90, 6]);
    await expect(plannedOn(r.planVersionId, REST_DAY)).rejects.toThrow();
  });

  describe("endurance (anomaly 2)", () => {
    it.each([
      ["no pain, no fatigue", {}],
      ["light fatigue (sleep 6.5 h, quality 6, energy 6)", LIGHT_FATIGUE],
    ] as const)("45 min, %s → KEEP: the planned document verbatim (main 30 min RPE 3–4)", async (name, checkin) => {
      const d = await day(`endurance 45 ${name}`, ENDURANCE_45, checkin);
      expect([d.plan.decision, d.plan.final_session]).toEqual(["KEEP", { kind: "AEROBIC_BASE", load_profile: "MODERATE", duration_min: 45 }]);
      expect(d.decision).toMatchObject({ final_prescription_status: "created", final_prescription_status_code: null });
      expect(d.decision.finals).toHaveLength(1);
      expect(sportFingerprint(d.decision.finals[0]!.structure)).toBe(sportFingerprint(d.planned!.structure));
    });

    it.each([
      ["high fatigue: systemic RED (M1 C3.3)", SYSTEMIC_RED, "C3"],
      ["high fatigue: legs 9 (M1 C3.6)", LEGS_RED, "C3"],
      ["knee pain 4/10 (M1 PAIN_NON_SAFETY)", KNEE_PAIN_4, "PAIN_NON_SAFETY"],
    ] as const)("45 min, %s → M1 MODIFY LIGHT 45, refused modify_not_supported: no final prescription, never the planned dose shown as lighter", async (name, checkin, rule) => {
      const d = await day(`endurance 45 ${name}`, ENDURANCE_45, checkin);
      expect([d.plan.decision, d.plan.final_session]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }]);
      expect(rules(d.plan).some((id) => id.includes(rule))).toBe(true);
      expect(d.decision).toMatchObject({
        final_prescription_status: "blocked",
        final_prescription_status_code: "final_prescription_adaptation_not_defined",
        final_prescription_status_detail: { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 },
      });
      expect(d.decision.finals).toEqual([]);
      expect(d.result).not.toHaveProperty("finalPrescription");
      // M1's own guidance stays the rider's instruction for the day.
      expect(d.plan.protection.do_not_do.length).toBeGreaterThan(0);
    });

    it("60 min, high fatigue (systemic RED) → MODIFY created and really lighter: 45 min (main 30 instead of 45), same protocol RPE", async () => {
      const d = await day("endurance 60 systemic red", ENDURANCE_60, SYSTEMIC_RED);
      expect([d.plan.decision, d.plan.final_session]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }]);
      expect(d.decision).toMatchObject({ final_prescription_status: "created", final_prescription_status_code: null });
      const [final] = d.decision.finals;
      expect(final).toMatchObject({ reconciliation_action: "modify", adaptation_rule_ids: ["v2.modify.endurance_light_duration"] });
      const st = final!.structure as Structure;
      expect([minutesOf(d.planned!.structure), minutesOf(st)]).toEqual([60, 45]);
      expect(mainOf(st).map((b) => [b.durationMinutes, b.rpeTarget])).toEqual([[{ min: 30, max: 30 }, { min: 3, max: 4 }]]);
    });

    it("45 min, high fatigue (systemic RED) and 30 min available → refused before A10: blocked, time not evaluated, M1's decision unchanged", async () => {
      const d = await day("endurance 45 systemic red 30 min", ENDURANCE_45, { ...SYSTEMIC_RED, available_minutes_today: 30 });
      expect([d.plan.decision, d.plan.final_session]).toEqual(["MODIFY", { kind: "AEROBIC_BASE", load_profile: "LIGHT", duration_min: 45 }]);
      const trace = d.plan.triggered_rules.find((t) => t.rule_id === "V2_TODAY_TIME_CONSTRAINT");
      expect(trace?.detail).toBe("Temps disponible : 30 min. Avant : MODIFY AEROBIC_BASE LIGHT 45 min. Action : not_evaluated.");
      expect(d.decision).toMatchObject({ final_prescription_status: "blocked", final_prescription_status_detail: { reason: "modify_not_supported" } });
      expect(d.decision.finals).toEqual([]);
    });

    it("60 min, high fatigue (systemic RED) and 30 min available → A10 adapts the real reduction: active recovery within 30 min", async () => {
      const d = await day("endurance 60 systemic red 30 min", ENDURANCE_60, { ...SYSTEMIC_RED, available_minutes_today: 30 });
      expect([d.plan.decision, d.plan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
      expect(d.decision).toMatchObject({ final_prescription_status: "created" });
      expect(minutesOf(d.decision.finals[0]!.structure as Structure)).toBeLessThanOrEqual(30);
    });

    it("45 min, no fatigue, 30 min available → A10: active recovery within 30 min (unchanged)", async () => {
      const d = await day("endurance 45 neutral 30 min", ENDURANCE_45, { available_minutes_today: 30 });
      expect([d.plan.decision, d.plan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
      expect(d.decision).toMatchObject({ final_prescription_status: "created" });
      expect(minutesOf(d.decision.finals[0]!.structure as Structure)).toBeLessThanOrEqual(30);
    });
  });

  describe("DH (anomaly 1: characterized, unchanged)", () => {
    it("no pain, no fatigue → KEEP DH MODERATE 90: the planned 6 passes", async () => {
      const d = await day("DH neutral", DH_DAY, {});
      expect([d.plan.decision, d.plan.final_session]).toEqual(["KEEP", { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }]);
      expect(passesOf(d.decision.finals[0]!.structure as Structure)).toBe(6);
    });

    it("knee pain 4/10 → M1 PAIN_NON_SAFETY: MODIFY DH LIGHT, the planned 90-min window, 4 passes, with M1's protection and monitoring", async () => {
      const d = await day("DH knee pain 4", DH_DAY, KNEE_PAIN_4);
      expect([d.plan.decision, d.plan.final_session]).toEqual(["MODIFY", { kind: "DH_TECHNICAL", load_profile: "LIGHT", duration_min: 90 }]);
      expect(rules(d.plan)).toContain("PAIN_NON_SAFETY");
      expect(d.plan.health_flag_to_create).toBeUndefined();
      expect(d.decision).toMatchObject({ final_prescription_status: "created" });
      const [final] = d.decision.finals;
      expect(final).toMatchObject({ reconciliation_action: "modify", adaptation_rule_ids: ["v2.modify.dh_light_passes"] });
      expect(passesOf(final!.structure as Structure)).toBe(4);
      expect(d.plan.protection.do_not_do.some((t) => t.startsWith("Éviter toute charge sollicitant fortement"))).toBe(true);
      expect(d.plan.monitoring.observe).toContain("Pendant la séance, arrête la partie DH si la douleur augmente clairement ou si ton contrôle se dégrade.");
    });

    it("knee pain 6/10 → Safety: REST, an open health flag, no final prescription", async () => {
      const d = await day("DH knee pain 6", DH_DAY, KNEE_PAIN_6);
      expect([d.plan.decision, d.plan.final_session.kind]).toEqual(["REST", "REST"]);
      expect(d.plan.health_flag_to_create).toBeDefined();
      expect(d.decision.finals).toEqual([]);
      const { data: open } = await admin.from("health_flags").select("id").eq("athlete_id", d.athleteId).in("status", ["active", "monitoring"]);
      expect(open).toHaveLength(1);
    });

    it("high fatigue: legs 9 → M1 C3.6 REPLACE DH_LIGHT LIGHT 90: 4 passes", async () => {
      const d = await day("DH legs 9", DH_DAY, LEGS_RED);
      expect([d.plan.decision, d.plan.final_session]).toEqual(["REPLACE", { kind: "DH_LIGHT", load_profile: "LIGHT", duration_min: 90 }]);
      expect(passesOf(d.decision.finals[0]!.structure as Structure)).toBe(4);
    });
  });

  it("rest day (nothing planned) → no V2 lineage, no final prescription (unchanged)", async () => {
    const d = await day("rest day", REST_DAY, {});
    expect(d.planned).toBeNull();
    expect(d.decision.finals).toEqual([]);
    expect(d.decision).toMatchObject({ final_prescription_status: "blocked", final_prescription_status_code: "final_prescription_no_lineage" });
  });

  it("insufficient data: no check-in → the daily run refuses to decide (unchanged)", async () => {
    const r = await rider("no check-in");
    await expect(runDailyFor(admin, r.athleteId, ENDURANCE_45)).rejects.toThrow(/No daily_checkins row/);
  });
});
