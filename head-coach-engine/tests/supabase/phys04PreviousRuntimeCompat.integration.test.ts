/**
 * PHYS-04 — rollback with the PREVIOUS runtime's real code (REL-01 D), on the LOCAL Supabase.
 *
 * Enabled only when PHYS011_PREVIOUS_RUNTIME_ROOT points at a built checkout of the previous release (its
 * head-coach-engine/dist). Nothing of that checkout is modified: its compiled modules are imported read-only.
 * (Option OFF — the default — plans are the previous planner's exactly: phys04MobilityBodyweight test G.)
 *
 * Proves, on a plan generated WITH the mobility option:
 *   1. D's KEEP of a planned mobility session is a verbatim copy of the routine (no error);
 *   2. D's A10 on a mobility day; a manual mobility session refused explicitly by D — no error anywhere;
 *   3. a bodyweight Force day after recorded sets: D builds the same session without repetitions guidance (no error);
 *   4. the precondition query (docs/release/phys04-rollback) counts exactly the mobility days still ahead.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
const ENABLED = localIntegrationRequested() && !!PREVIOUS;
const PRECONDITION_SQL = readFileSync(new URL("../../../docs/release/phys04-rollback/ROLLBACK_TO_D_PRECONDITION.sql", import.meta.url), "utf8");
function rollbackBlockers(athleteId: string, fromDate: string): { intervals: number; power: number; mobility: number; last: string | null } {
  const sql = PRECONDITION_SQL.replace("(now() at time zone 'Europe/Zurich')::date", `${sqlLiteral(fromDate)}::date`).replace(
    "where g.kind in ('AEROBIC_INTERVALS', 'POWER', 'MOBILITY')",
    `where c.athlete_id = ${sqlLiteral(athleteId)} and g.kind in ('AEROBIC_INTERVALS', 'POWER', 'MOBILITY')`
  );
  const [intervals, power, mobility, , last] = execLocalSql(sql).trim().split("|");
  return { intervals: Number(intervals), power: Number(power), mobility: Number(mobility), last: last === "" ? null : last! };
}

type Structure = { family: string; protocolId?: string; blocks: { role: string; items: { prescriptionItemId: string; exerciseId: string; sets: number; measure: { min: number }; rpeTarget?: { max: number }; repsGuidance?: unknown }[] }[] };

describe.skipIf(!ENABLED)("PHYS-04 — previous runtime (D) on plans holding mobility sessions (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  let previousRunDailyFor: typeof runDailyFor;
  beforeAll(async () => {
    admin = createTestClient();
    previousRunDailyFor = (await import(pathToFileURL(join(PREVIOUS!, "head-coach-engine", "dist", "supabase", "runDailyFor.js")).href)).runDailyFor;
  });

  async function rider(name: string, tier: "beginner" | "intermediate" = "intermediate") {
    const { athleteId } = await createTestAthlete(admin, `PHYS-04 compat ${name}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: tier,
      equipment: [],
      terrain_access: ["flow_trail", "bermed_trail"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const persisted = await generateAndPersistTrainingPlanV2(
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", mobilitySessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    return athleteId;
  }
  const finalOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", decisionId).maybeSingle();
    return data as { id: string; structure: Structure } | null;
  };
  const exerciseIds = (s: Structure) => s.blocks.flatMap((b) => b.items.map((i) => i.exerciseId));

  it("1 / 2 — D on mobility days: KEEP copies the routine; A10 25 min; a manual mobility session refused — never an error", async () => {
    const athleteId = await rider("D runtime");
    await insertCheckin(admin, athleteId, "2026-10-28");
    const keep = await previousRunDailyFor(admin, athleteId, "2026-10-28");
    const fKeep = (await finalOf(keep.persistence.decision_id))!;
    expect([keep.dailyPlan.decision, keep.finalPrescriptionStatus, fKeep.structure.family, fKeep.structure.protocolId]).toEqual(["KEEP", "created", "mobility", "mobility_routine_v1"]);
    const now = await rider("PHYS-04 runtime");
    await insertCheckin(admin, now, "2026-10-28");
    expect(exerciseIds(fKeep.structure)).toEqual(exerciseIds((await finalOf((await runDailyFor(admin, now, "2026-10-28")).persistence.decision_id))!.structure));

    const a10Rider = await rider("D A10");
    await insertCheckin(admin, a10Rider, "2026-10-28", { available_minutes_today: 25 });
    const a10 = await previousRunDailyFor(admin, a10Rider, "2026-10-28");
    expect([a10.dailyPlan.decision, a10.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);

    const { error } = await (await getAthleteAuthClient(athleteId))
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: "2026-10-18", session_type: "RECOVERY", intervention: { kind: "MOBILITY" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
    await insertCheckin(admin, athleteId, "2026-10-18");
    const manual = await previousRunDailyFor(admin, athleteId, "2026-10-18");
    expect([manual.finalPrescriptionStatus, manual.finalPrescriptionStatusDetail?.reason]).toEqual(["blocked", "manual_kind_not_supported"]);
  });

  it("3 — a bodyweight Force day after recorded sets: D builds the same work exercises, without repetitions guidance", async () => {
    const athleteId = await rider("bodyweight", "beginner");
    await insertCheckin(admin, athleteId, "2026-10-14");
    const f14 = (await finalOf((await runDailyFor(admin, athleteId, "2026-10-14")).persistence.decision_id))!;
    const workOf = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items);
    const work = workOf(f14.structure);
    const id = randomUUID();
    const rpc = async (payload: unknown) => {
      const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
      if (error) throw new Error(error.message);
      expect(data).toMatchObject({ status: "ok" });
    };
    await rpc({ execution: { id, session_date: "2026-10-14", started_at: "2026-10-14T17:00:00Z", final_prescription_id: f14.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: "2026-10-14T17:00:00Z" }] });
    await rpc({
      sets: work.flatMap((i) => Array.from({ length: i.sets }, (_, k) => ({ id: randomUUID(), execution_id: id, prescription_item_id: i.prescriptionItemId, set_number: k + 1, done: true, measure_type: "reps", measure_value: i.measure.min, rpe: i.rpeTarget?.max ?? null, occurred_at: `2026-10-14T17:${String(10 + k).padStart(2, "0")}:00Z` }))),
      events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: "2026-10-14T17:55:00Z" }],
    });
    await insertCheckin(admin, athleteId, "2026-10-21");
    const d = await previousRunDailyFor(admin, athleteId, "2026-10-21");
    const f21 = (await finalOf(d.persistence.decision_id))!;
    // (D has no PHYS-01 daily cool-down either: a known PHYS-01 rollback limit, not a PHYS-04 one.)
    expect([d.dailyPlan.decision, d.finalPrescriptionStatus, workOf(f21.structure).map((i) => i.exerciseId), JSON.stringify(f21.structure).includes("repsGuidance")]).toEqual(["KEEP", "created", work.map((i) => i.exerciseId), false]);
  });

  it("4 — the precondition query counts the mobility days still ahead (0 after the last one)", async () => {
    const athleteId = await rider("precondition");
    expect([rollbackBlockers(athleteId, "2026-10-28"), rollbackBlockers(athleteId, "2026-10-29")]).toEqual([
      { intervals: 0, power: 0, mobility: 1, last: "2026-10-28" },
      { intervals: 0, power: 0, mobility: 0, last: null },
    ]);
  });
});
