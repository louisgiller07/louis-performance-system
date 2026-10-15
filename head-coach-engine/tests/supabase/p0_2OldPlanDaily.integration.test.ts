/**
 * P0-2 (HPM 2026-10-13) — an existing V2 plan carrying the off-camber drill, adapted by the real daily-run
 * after the catalogue change (local Supabase, real M1, real reconciliation, real persistence).
 *
 * Before P0-2 a technical trail was enough for cornering_off_camber. The plan is generated with the off-camber
 * section declared — the same stored content the base produced — then the profile goes back to the rider's
 * pre-P0-2 answers (technical trail, no off-camber section). The stored plan must stay adaptable: KEEP verbatim,
 * MODIFY created (never final_prescription_catalog_mismatch), same drill, the stored planned prescription untouched.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { upsertPerformanceProfileFor, type AthletePerformanceProfileWriteFields } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTEGRATION_ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };

type Item = { kind: string; drillId?: string; cueId?: string; successCriterionId?: string; prescriptionItemId: string; derivedFromItemId?: string; measure: { type: string; count?: number } };
type Structure = { intentId: string; catalog: { aggregate: string }; blocks: { role: string; items: Item[] }[] };

const profile = (terrain_access: string[]): AthletePerformanceProfileWriteFields => ({
  strength_experience_tier: "intermediate",
  equipment: ["dumbbells", "bench"],
  terrain_access,
  declared_limitations: [],
  technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
  dh_technical_tier: "advanced",
});

describe.skipIf(!INTEGRATION_ENABLED)("P0-2 — an existing off-camber V2 plan, adapted by the real daily-run after the catalogue change", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  let athleteId: string;
  let planVersionId: string;

  async function plannedStructure(day: string): Promise<Structure> {
    const { data: s } = await admin.from("training_plan_generated_sessions").select("id").eq("plan_version_id", planVersionId).eq("date", day).single();
    const { data: p } = await admin.from("training_plan_planned_prescriptions").select("structure").eq("generated_plan_session_id", s!.id).single();
    return p!.structure as Structure;
  }
  async function finalOn(day: string) {
    const { data: d } = await admin.from("decisions").select("id, final_prescription_status, final_prescription_status_code").eq("athlete_id", athleteId).eq("decision_date", day).order("created_at", { ascending: false }).limit(1);
    const { data: f } = await admin.from("decision_final_prescriptions").select("reconciliation_action, structure").eq("decision_id", d![0]!.id);
    return { decision: d![0]!, final: f![0] as { reconciliation_action: string; structure: Structure } | undefined };
  }
  const mainDrill = (st: Structure) => st.blocks.find((b) => b.role === "main")!.items[0]!;

  beforeAll(async () => {
    admin = createTestClient();
    athleteId = (await createTestAthlete(admin, `P0-2 old plan ${randomUUID().slice(0, 6)}`)).athleteId;
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, profile(["technical_trail", "off_camber_section"]));
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (persisted.status !== "persisted") throw new Error(`plan: ${JSON.stringify(persisted)}`);
    planVersionId = persisted.planVersionId;
    await acceptTrainingPlanVersion(admin, athleteId, planVersionId, "2026-10-05", "2026-10-18");
    // Back to the rider's pre-P0-2 answers: a technical trail, no declared off-camber section.
    await upsertPerformanceProfileFor(admin, athleteId, profile(["technical_trail"]));
  }, 90_000);

  it("the stored plan holds the off-camber drill under the runtime aggregate (session-model-v2.7 since PHYS-01), with its unchanged texts and intent", async () => {
    const st = await plannedStructure("2026-10-12");
    expect(st.catalog.aggregate).toBe("session-model-v2.7");
    expect(mainDrill(st)).toMatchObject({ drillId: "cornering_off_camber", cueId: "cue.cornering_off_camber", successCriterionId: "criterion.cornering_off_camber" });
    expect(st.intentId).toBe("dh_corner_exit_speed");
  });

  it("KEEP: the stored mission, verbatim", async () => {
    const day = "2026-10-12";
    await insertCheckin(admin, athleteId, day);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.finalPrescriptionStatus]).toEqual(["KEEP", "created"]);
    const { final } = await finalOn(day);
    expect(final!.structure).toEqual(await plannedStructure(day));
  });

  it("MODIFY (systemic RED → LIGHT): created, never a catalog mismatch; same drill, 4 passages, lineage; the planned prescription untouched", async () => {
    const day = "2026-10-13";
    const plannedBefore = await plannedStructure(day);
    await insertCheckin(admin, athleteId, day, SYSTEMIC_RED);
    const r = await runDailyFor(admin, athleteId, day);
    expect([r.dailyPlan.decision, r.dailyPlan.final_session.load_profile, r.finalPrescriptionStatus]).toEqual(["MODIFY", "LIGHT", "created"]);
    const { decision, final } = await finalOn(day);
    expect(decision.final_prescription_status_code).not.toBe("final_prescription_catalog_mismatch");
    expect(final!.reconciliation_action).toBe("modify");
    const drill = mainDrill(final!.structure);
    expect([drill.drillId, drill.measure.count, drill.derivedFromItemId]).toEqual(["cornering_off_camber", 4, mainDrill(plannedBefore).prescriptionItemId]);
    expect(await plannedStructure(day)).toEqual(plannedBefore);
  });
});
