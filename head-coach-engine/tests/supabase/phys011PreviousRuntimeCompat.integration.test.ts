/**
 * PHYS-01.1 — rollback / roll-forward with the PREVIOUS runtime's real code (REL-01 D), on the LOCAL Supabase.
 *
 * Enabled only when PHYS011_PREVIOUS_RUNTIME_ROOT points at a built checkout of the previous release (its
 * head-coach-engine/dist and planning-engine/dist), e.g. the D deploy worktree. Nothing of that checkout is
 * modified: its compiled modules are imported read-only.
 *
 * Proves, on real data:
 *   1. the plan both runtimes generate for the same snapshot is identical (no format change);
 *   2. PHYS-01.1 day → previous runtime day (Edge rolled back): KEEP and MODIFY work on the same plan, no
 *      catalogue mismatch, no crash; its documents simply have no cool-down and no guidance;
 *   3. previous runtime day → PHYS-01.1 day (rolled forward): the guidance reads the sets recorded against
 *      the previous runtime's prescription as well.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";
import * as currentV2 from "planning-engine/session-model-v2";

const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
const ENABLED = localIntegrationRequested() && !!PREVIOUS;
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };

type Item = { kind: string; prescriptionItemId: string; exerciseId: string; sets: number; measure: { min?: number; max?: number }; rpeTarget?: { max: number }; loadGuidance?: Record<string, unknown> };
type Structure = { catalog: { aggregate: string }; blocks: { role: string; items: Item[] }[] };

describe.skipIf(!ENABLED)("PHYS-01.1 — previous runtime (D) and PHYS-01.1 on the same data (local Supabase)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  let previousRunDailyFor: typeof runDailyFor;
  let previousV2: typeof currentV2;
  beforeAll(async () => {
    admin = createTestClient();
    previousRunDailyFor = (await import(pathToFileURL(join(PREVIOUS!, "head-coach-engine", "dist", "supabase", "runDailyFor.js")).href)).runDailyFor;
    previousV2 = await import(pathToFileURL(join(PREVIOUS!, "planning-engine", "dist", "sessionModelV2", "index.js")).href);
  });

  it("1 — same snapshot, same ids → the previous runtime and PHYS-01.1 generate exactly the same plan", () => {
    const snapshot = {
      discipline: "Downhill",
      races: [],
      availability: { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" })), exceptions: [] },
      equipment: ["barbell", "squat_rack", "dumbbells", "bench", "cable_machine", "pull_up_bar"],
      terrainAccess: ["flow_trail", "bermed_trail"],
      strengthExperienceTier: "advanced" as const,
      declaredLimitations: [],
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      lockedDates: [],
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
      dhTechnicalTier: "intermediate" as const,
    };
    const generate = (v2: typeof currentV2) => {
      let n = 0;
      const r = v2.generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "P", mode: "UNSPECIFIED", primaryFocus: "T", startDate: "2026-10-05", endDate: "2026-11-15" }, snapshot, mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
      if (r.status !== "generated") throw new Error(r.status);
      return r.plan;
    };
    const previous = generate(previousV2);
    const current = generate(currentV2);
    expect(current.weeks.flatMap((w) => w.sessions.map((s) => s.plannedPrescription.structure))).toEqual(previous.weeks.flatMap((w) => w.sessions.map((s) => s.plannedPrescription.structure)));
    expect(previousV2.SESSION_MODEL_V2_AGGREGATE_VERSION).toBe(currentV2.SESSION_MODEL_V2_AGGREGATE_VERSION);
  });

  it("2 / 3 — PHYS-01.1 day, then the previous runtime (KEEP, MODIFY), then PHYS-01.1 again reading every recorded set", async () => {
    const { athleteId } = await createTestAthlete(admin, "PHYS-01.1 previous runtime");
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "advanced",
      equipment: ["barbell", "squat_rack", "dumbbells", "bench", "cable_machine", "pull_up_bar"],
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
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data: uppers } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", persisted.planVersionId).eq("kind", "STRENGTH_UPPER").order("date");
    const { data: lowers } = await admin.from("training_plan_generated_sessions").select("date").eq("plan_version_id", persisted.planVersionId).eq("kind", "STRENGTH_LOWER").order("date");
    const [u1, u2, u3] = uppers!.map((r) => r.date as string) as [string, string, string];
    const l2 = lowers![1]!.date as string;

    const finalOf = async (decisionId: string) => {
      const { data } = await admin.from("decision_final_prescriptions").select("id, structure, reconciliation_action").eq("decision_id", decisionId).single();
      return data as { id: string; structure: Structure; reconciliation_action: string };
    };
    const bench = (s: Structure) => s.blocks.find((b) => b.role === "main")!.items[0]!;
    const record = async (payload: unknown) => {
      const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
      if (error) throw new Error(error.message);
      return data as { status: string };
    };
    async function perform(date: string, fp: { id: string; structure: Structure }, kg: number) {
      const b = bench(fp.structure);
      const id = randomUUID();
      expect(await record({ execution: { id, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${date}T17:00:00Z` }] })).toMatchObject({ status: "ok" });
      const sets = Array.from({ length: b.sets }, (_, i) => ({ id: randomUUID(), execution_id: id, prescription_item_id: b.prescriptionItemId, set_number: i + 1, done: true, measure_type: "reps", measure_value: b.measure.max, load_kg: kg, rpe_actual: b.rpeTarget!.max, occurred_at: `${date}T17:1${i}:00Z` }));
      expect(await record({ sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${date}T17:55:00Z` }] })).toMatchObject({ status: "ok" });
    }

    // Day u1 — PHYS-01.1: KEEP + daily cool-down + calibration guidance; the rider records 50 kg.
    await insertCheckin(admin, athleteId, u1);
    const r1 = await runDailyFor(admin, athleteId, u1);
    const f1 = await finalOf(r1.persistence.decision_id);
    expect([f1.reconciliation_action, f1.structure.blocks.at(-1)!.role, f1.structure.catalog.aggregate, bench(f1.structure).loadGuidance?.mode]).toEqual(["keep", "cool_down", "session-model-v2.6", "calibrate"]);
    await perform(u1, f1, 50);

    // Day u2 — Edge rolled back to the previous runtime: same plan, KEEP works (its own document, no addition).
    await insertCheckin(admin, athleteId, u2);
    const r2 = await previousRunDailyFor(admin, athleteId, u2);
    expect([r2.dailyPlan.decision, r2.finalPrescriptionStatus]).toEqual(["KEEP", "created"]);
    const f2 = await finalOf(r2.persistence.decision_id);
    expect(f2.structure.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "complementary", "complementary"]);
    expect(JSON.stringify(f2.structure)).not.toMatch(/loadGuidance/);
    await perform(u2, f2, 55);
    // …and its MODIFY on the same plan (systemic RED): created, no catalogue mismatch, no crash.
    await insertCheckin(admin, athleteId, l2, SYSTEMIC_RED);
    const rMod = await previousRunDailyFor(admin, athleteId, l2);
    expect([rMod.dailyPlan.decision, rMod.finalPrescriptionStatus]).toEqual(["MODIFY", "created"]);

    // Day u3 — rolled forward to PHYS-01.1: the guidance reads the sets recorded against the previous runtime's prescription (u2).
    await insertCheckin(admin, athleteId, u3);
    const r3 = await runDailyFor(admin, athleteId, u3);
    const f3 = await finalOf(r3.persistence.decision_id);
    expect(bench(f3.structure).loadGuidance).toMatchObject({ mode: "target", reference: { sessionDate: u2, loadKg: 55 } });
    expect(f3.structure.blocks.at(-1)!.role).toBe("cool_down");
  });
});
