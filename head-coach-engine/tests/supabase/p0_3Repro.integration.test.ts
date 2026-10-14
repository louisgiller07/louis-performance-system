/**
 * P0-3 — the R1–R5 reference (HPM 2026-10-13), on the production schema: real generation, acceptance/projection,
 * the web's own manual write (rider JWT, RLS, F3 payload), check-in, real daily-run.
 *
 * Diagnostic (cf099f3) → after the P0-3 fix:
 *  R1  V1 plan — manual DH → Force: KEEP, no executable prescription — UNCHANGED in the engine (no V1 builder,
 *      HPM F2); the web now says so plainly (p0_3ManualSessions.test.tsx).
 *  R2  V2 plan — manual DH → Force: was blocked final_prescription_no_lineage → now a complete Force, manual contract.
 *  R3  V1 plan — 30 min declared: DH unchanged — UNCHANGED (V1 never reads it; the V1 check-in never asks it).
 *  R4  V2 plan — manual DH 90 + 30 min: was not_evaluated / DH 90 kept → now adapted to the time, traced.
 *  R5  V2 plan — generated DH + 30 min (control): unchanged.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlan } from "../../src/supabase/generateAndPersistTrainingPlan.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

type Row = { planned_date: string; session_type: string; source: string; intervention: Record<string, unknown> | null; source_generated_session_id: string | null; source_plan_version_id: string | null };

describe.skipIf(!ENABLED)("P0-3 — R1–R5 reference (local, production schema)", { timeout: 180_000 }, () => {
  let admin: SupabaseClient;
  const report: Record<string, unknown> = {};

  async function rider(model: "v1" | "v2") {
    const { athleteId } = await createTestAthlete(admin, `P0-3 ${model} ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench", "barbell", "squat_rack"],
      terrain_access: ["flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const common = { client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" };
    const planVersionId = model === "v1" ? (await generateAndPersistTrainingPlan(common)).planVersionId : await (async () => {
      const r = await generateAndPersistTrainingPlanV2({ planningModel: "v2", ...common });
      if (r.status !== "persisted") throw new Error(JSON.stringify(r));
      return r.planVersionId;
    })();
    await acceptTrainingPlanVersion(admin, athleteId, planVersionId, "2026-10-05", "2026-10-18");
    return { athleteId, planVersionId, rider: await getAthleteAuthClient(athleteId) };
  }
  async function rows(athleteId: string): Promise<Row[]> {
    const { data } = await admin.from("planned_sessions").select("planned_date, session_type, source, intervention, source_generated_session_id, source_plan_version_id").eq("athlete_id", athleteId).order("planned_date");
    return data as Row[];
  }
  const dhDays = (r: Row[]) => r.filter((x) => x.source === "generated" && (x.intervention?.kind === "DH_TECHNICAL" || x.session_type.startsWith("DH"))).map((x) => x.planned_date);
  /** Exactly the web's savePlannedSession write (planningRepo.ts), with the rider's own JWT. */
  async function manual(client: SupabaseClient, athleteId: string, date: string, intervention: Record<string, unknown>, session_type: string) {
    const { error } = await client
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: date, session_type, intervention, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
  }
  const summary = (r: Awaited<ReturnType<typeof runDailyFor>>) => ({
    decision: r.dailyPlan.decision,
    finalSession: r.dailyPlan.final_session,
    rules: r.dailyPlan.triggered_rules.map((x) => x.rule_id),
    executablePrescriptionStatus: r.executablePrescriptionStatus,
    hasExecutablePrescription: r.executablePrescription != null,
    finalPrescriptionStatus: r.finalPrescriptionStatus ?? null,
    finalPrescriptionStatusCode: r.finalPrescriptionStatusCode ?? null,
  });

  beforeAll(() => {
    admin = createTestClient();
  });

  it("R1 / R3 — V1 plan (production default for new accounts)", async () => {
    const a = await rider("v1");
    const days = dhDays(await rows(a.athleteId));
    expect(days.length).toBeGreaterThanOrEqual(2);
    const [d1, d3] = [days[0]!, days[1]!];

    await manual(a.rider, a.athleteId, d1, { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B");
    const replaced = (await rows(a.athleteId)).find((x) => x.planned_date === d1)!;
    await insertCheckin(admin, a.athleteId, d1);
    const r1 = summary(await runDailyFor(admin, a.athleteId, d1));
    report.R1 = { plannedRowAfterManualReplace: replaced, daily: r1 };

    await insertCheckin(admin, a.athleteId, d3, { available_minutes_today: 30 });
    const r3 = summary(await runDailyFor(admin, a.athleteId, d3));
    report.R3 = { daily: r3 };

    // F3 — the manual write cleared the generated lineage it replaced (rider JWT, RLS).
    expect([replaced.source, replaced.source_generated_session_id, replaced.source_plan_version_id]).toEqual(["manual", null, null]);
    // V1 — unchanged in the engine (honest web copy instead):
    expect([r1.decision, r1.finalSession.kind, r1.executablePrescriptionStatus, r1.hasExecutablePrescription]).toEqual(["KEEP", "STRENGTH_UPPER", "none", false]);
    expect(r3.finalSession.kind).toBe("DH_TECHNICAL");
    expect(r3.rules).not.toContain("V2_TODAY_TIME_CONSTRAINT");
  });

  it("R2 / R4 / R5 — V2 plan", async () => {
    const a = await rider("v2");
    const days = dhDays(await rows(a.athleteId));
    expect(days.length).toBeGreaterThanOrEqual(3);
    const [d2, d4, d5] = [days[0]!, days[1]!, days[2]!];

    await manual(a.rider, a.athleteId, d2, { kind: "STRENGTH_UPPER", load_profile: "MODERATE" }, "STRENGTH_B");
    await insertCheckin(admin, a.athleteId, d2);
    const r2 = summary(await runDailyFor(admin, a.athleteId, d2));
    report.R2 = { daily: r2 };

    await manual(a.rider, a.athleteId, d4, { kind: "DH_TECHNICAL", load_profile: "MODERATE", duration_min: 90 }, "DH_TECHNICAL");
    await insertCheckin(admin, a.athleteId, d4, { available_minutes_today: 30 });
    const r4 = summary(await runDailyFor(admin, a.athleteId, d4));
    report.R4 = { daily: r4 };

    await insertCheckin(admin, a.athleteId, d5, { available_minutes_today: 30 });
    const r5 = summary(await runDailyFor(admin, a.athleteId, d5));
    report.R5 = { daily: r5 };

    if (process.env.P0_3_REPORT) writeFileSync(process.env.P0_3_REPORT, JSON.stringify(report, null, 2));
    // R2 / R4 fixed, R5 (control) unchanged:
    expect([r2.decision, r2.finalSession.kind, r2.finalPrescriptionStatus, r2.finalPrescriptionStatusCode]).toEqual(["KEEP", "STRENGTH_UPPER", "created", null]);
    expect([r4.decision, r4.finalSession.kind, r4.finalPrescriptionStatus]).toEqual(["REPLACE", "RECOVERY_ACTIVE", "created"]);
    expect(r4.rules).toContain("V2_TODAY_TIME_CONSTRAINT");
    expect(r5.rules).toContain("V2_TODAY_TIME_CONSTRAINT");
    expect(r5.finalPrescriptionStatus).toBe("created");
  });
});
