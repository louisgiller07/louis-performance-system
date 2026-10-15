/**
 * PHYS-03 — rollback with the PREVIOUS runtime's real code (REL-01 D), on the LOCAL Supabase.
 *
 * Enabled only when PHYS011_PREVIOUS_RUNTIME_ROOT points at a built checkout of the previous release (its
 * head-coach-engine/dist). Nothing of that checkout is modified: its compiled modules are imported read-only.
 * (Option OFF — the default — plans are the previous planner's exactly: phys02PreviousRuntimeCompat test 1.)
 *
 * Proves, on a plan generated WITH the power option:
 *   1. D's KEEP of a planned power session is a verbatim copy (no error);
 *   2. D's MODIFY to LIGHT is refused gracefully (modify_family_not_supported); D's A10 falls back to recovery;
 *      a manual power session is refused explicitly — no error anywhere;
 *   3. the safety gap of a rollback: on a legs-fatigue day D prescribes the power session (no PHYS-03 hold),
 *      while PHYS-03 withholds it on the same data;
 *   4. the precondition query (docs/release/phys03-rollback) counts exactly the power days still ahead.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline, type CheckinFixture } from "./testDb.js";
import { execLocalSql, localIntegrationRequested, sqlLiteral } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
const ENABLED = localIntegrationRequested() && !!PREVIOUS;
const SYSTEMIC_RED: CheckinFixture = { sleep_hours: 4, sleep_quality: 2, sleep_wake_ups: 4, energy: 2 };
const PRECONDITION_SQL = readFileSync(new URL("../../../docs/release/phys03-rollback/ROLLBACK_TO_D_PRECONDITION.sql", import.meta.url), "utf8");
function rollbackBlockers(athleteId: string, fromDate: string): { intervals: number; power: number; last: string | null } {
  const sql = PRECONDITION_SQL.replace("(now() at time zone 'Europe/Zurich')::date", `${sqlLiteral(fromDate)}::date`).replace(
    "where g.kind in ('AEROBIC_INTERVALS', 'POWER')",
    `where c.athlete_id = ${sqlLiteral(athleteId)} and g.kind in ('AEROBIC_INTERVALS', 'POWER')`
  );
  const [intervals, power, , last] = execLocalSql(sql).trim().split("|");
  return { intervals: Number(intervals), power: Number(power), last: last === "" ? null : last! };
}

describe.skipIf(!ENABLED)("PHYS-03 — previous runtime (D) on plans holding power sessions (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  let previousRunDailyFor: typeof runDailyFor;
  beforeAll(async () => {
    admin = createTestClient();
    previousRunDailyFor = (await import(pathToFileURL(join(PREVIOUS!, "head-coach-engine", "dist", "supabase", "runDailyFor.js")).href)).runDailyFor;
  });

  async function rider(name: string) {
    const { athleteId } = await createTestAthlete(admin, `PHYS-03 compat ${name}`);
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", powerSessions: true },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    return athleteId;
  }
  const familyOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("structure").eq("decision_id", decisionId).maybeSingle();
    return (data as { structure: { family: string } } | null)?.structure.family ?? null;
  };

  it("1 / 2 — D on power days: KEEP copies the power session; LIGHT refused gracefully; A10 → recovery; a manual power session refused — never an error", async () => {
    const athleteId = await rider("D runtime");
    await insertCheckin(admin, athleteId, "2026-10-14");
    const keep = await previousRunDailyFor(admin, athleteId, "2026-10-14");
    expect([keep.dailyPlan.decision, keep.finalPrescriptionStatus, await familyOf(keep.persistence.decision_id)]).toEqual(["KEEP", "created", "power"]);
    await insertCheckin(admin, athleteId, "2026-11-04", SYSTEMIC_RED);
    const light = await previousRunDailyFor(admin, athleteId, "2026-11-04");
    expect([light.dailyPlan.decision, light.finalPrescriptionStatus, light.finalPrescriptionStatusDetail?.reason]).toEqual(["MODIFY", "blocked", "modify_family_not_supported"]);
    const a10Rider = await rider("D A10");
    await insertCheckin(admin, a10Rider, "2026-10-14", { available_minutes_today: 45 });
    const a10 = await previousRunDailyFor(admin, a10Rider, "2026-10-14");
    expect([a10.dailyPlan.decision, a10.dailyPlan.final_session.kind]).toEqual(["REPLACE", "RECOVERY_ACTIVE"]);
    const { error } = await (await getAthleteAuthClient(athleteId))
      .from("planned_sessions")
      .upsert({ athlete_id: athleteId, planned_date: "2026-10-18", session_type: "STRENGTH_B", intervention: { kind: "POWER", load_profile: "MODERATE" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
    await insertCheckin(admin, athleteId, "2026-10-18");
    const manual = await previousRunDailyFor(admin, athleteId, "2026-10-18");
    expect([manual.finalPrescriptionStatus, manual.finalPrescriptionStatusDetail?.reason]).toEqual(["blocked", "manual_kind_not_supported"]);
    // …which PHYS-03 builds (the rider's own choice, at MODERATE, intermediate tier).
    const now = await runDailyFor(admin, athleteId, "2026-10-18");
    expect([now.finalPrescriptionStatus, await familyOf(now.persistence.decision_id)]).toEqual(["created", "power"]);
  });

  it("3 — the safety gap of a rollback: tired legs on a power day — D prescribes the power session, PHYS-03 withholds it", async () => {
    const athleteId = await rider("fatigue");
    await insertCheckin(admin, athleteId, "2026-10-14", { leg_fatigue: 8 });
    const d = await previousRunDailyFor(admin, athleteId, "2026-10-14");
    expect([d.dailyPlan.decision, d.finalPrescriptionStatus, await familyOf(d.persistence.decision_id)]).toEqual(["KEEP", "created", "power"]);
    const now = await runDailyFor(admin, athleteId, "2026-10-14");
    expect([now.finalPrescriptionStatus, now.finalPrescriptionStatusDetail?.reason]).toEqual(["blocked", "power_fatigue_not_cleared"]);
  });

  it("4 — the precondition query counts the power days still ahead (0 after the last one)", async () => {
    const athleteId = await rider("precondition");
    expect([rollbackBlockers(athleteId, "2026-10-14"), rollbackBlockers(athleteId, "2026-10-15"), rollbackBlockers(athleteId, "2026-11-05")]).toEqual([
      { intervals: 0, power: 2, last: "2026-11-04" },
      { intervals: 0, power: 1, last: "2026-11-04" },
      { intervals: 0, power: 0, last: null },
    ]);
  });
});
