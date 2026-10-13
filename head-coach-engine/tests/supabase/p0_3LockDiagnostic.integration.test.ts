/**
 * P0-3 (HPM 2026-10-13, server lock) — diagnostic on the production schema, BEFORE any lock: the plan acceptance
 * projection (project_training_plan, window starting today) on a day whose V2 guided session is completed or still
 * running. The projection only skips days with a legacy completed_sessions row or a manual row: a V2 execution does
 * not protect the day's planned session. Measured, nothing changed.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, insertCheckin, isLoopbackSupabaseUrl, resolveTestSupabaseUrl, setAthleteDiscipline } from "./testDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { generateAndPersistTrainingPlanV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { runDailyFor } from "../../src/supabase/runDailyFor.js";

const SERVER_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.RUN_LOCAL_SUPABASE_INTEGRATION === "1" && !!SERVER_KEY && isLoopbackSupabaseUrl(resolveTestSupabaseUrl());

type Item = { kind: string; prescriptionItemId: string; measure: { type: string } };
type Structure = { family: string; blocks: { role: string; items: Item[] }[] };

describe.skipIf(!ENABLED)("P0-3 diagnostic — plan acceptance projection on a day with a V2 execution (local, production schema)", { timeout: 240_000 }, () => {
  let admin: SupabaseClient;
  const report: Record<string, unknown> = {};

  beforeAll(() => {
    admin = createTestClient();
  });

  async function riderWithPlan(name: string) {
    const { athleteId } = await createTestAthlete(admin, `P0-3 lock diag ${name} ${randomUUID().slice(0, 6)}`);
    await setAthleteDiscipline(admin, athleteId, "Downhill");
    await upsertPerformanceProfileFor(admin, athleteId, {
      strength_experience_tier: "intermediate",
      equipment: ["dumbbells", "bench"],
      terrain_access: ["flow_trail", "bermed_trail", "full_dh_track"],
      declared_limitations: [],
      technical_priorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
      dh_technical_tier: "intermediate",
    });
    for (const d of [0, 1, 2, 3, 4, 5, 6]) await insertAvailabilityWindow(admin, athleteId, { day_of_week: d, start_time: "08:00:00", end_time: "20:00:00" });
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: "2026-10-04" });
    if (p.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, "2026-10-05", "2026-10-18");
    const { data } = await admin.from("planned_sessions").select("planned_date, intervention").eq("athlete_id", athleteId).order("planned_date");
    const day = (data as { planned_date: string; intervention: { kind: string } | null }[]).find((r) => r.intervention?.kind === "DH_TECHNICAL")!.planned_date;
    return { athleteId, planVersionId: p.planVersionId, day };
  }

  async function startOn(athleteId: string, day: string, complete: boolean) {
    await insertCheckin(admin, athleteId, day);
    const r = await runDailyFor(admin, athleteId, day);
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure").eq("decision_id", r.persistence.decision_id).single();
    const fp = data as { id: string; structure: Structure };
    const id = randomUUID();
    const rpc = async (payload: unknown) => (await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload })).data as { status: string };
    expect(await rpc({ execution: { id, session_date: day, started_at: `${day}T17:00:00Z`, final_prescription_id: fp.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${day}T17:00:00Z` }] })).toMatchObject({ status: "ok" });
    if (complete) {
      const pass = fp.structure.blocks.find((b) => b.role === "main")!.items[0]!;
      const set = { id: randomUUID(), execution_id: id, prescription_item_id: pass.prescriptionItemId, set_number: 1, done: true, measure_type: pass.measure.type, measure_value: pass.measure.type === "pass" ? null : 8, occurred_at: `${day}T17:30:00Z` };
      expect(await rpc({ sets: [set], events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${day}T18:00:00Z` }] })).toMatchObject({ status: "ok" });
    }
  }

  async function regenerateAndAcceptOn(athleteId: string, day: string) {
    const p = await generateAndPersistTrainingPlanV2({ planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 2, today: day });
    if (p.status !== "persisted") throw new Error("plan 2");
    const end = new Date(Date.parse(`${day}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
    const outcome = await acceptTrainingPlanVersion(admin, athleteId, p.planVersionId, day, end);
    const { data: planned } = await admin.from("planned_sessions").select("source, source_plan_version_id").eq("athlete_id", athleteId).eq("planned_date", day);
    return { outcome: outcome.projection?.plannedSessions.filter((s) => s.date === day).map((s) => s.outcome), warnings: outcome.warnings, plannedRowsOnDay: planned!.length };
  }

  for (const complete of [true, false]) {
    const label = complete ? "completed" : "running";
    it(`a ${label} V2 session on X, then a new plan generated and accepted on X: the projection removes X's planned session`, async () => {
      const r = await riderWithPlan(label);
      await startOn(r.athleteId, r.day, complete);
      const after = await regenerateAndAcceptOn(r.athleteId, r.day);
      report[label] = { day: r.day, ...after };
      expect(after).toEqual({ outcome: ["removed_superseded"], warnings: [], plannedRowsOnDay: 0 });
    });
  }

  it("report", () => {
    if (process.env.P0_3_REPORT) writeFileSync(process.env.P0_3_REPORT, JSON.stringify(report, null, 2));
  });
});
