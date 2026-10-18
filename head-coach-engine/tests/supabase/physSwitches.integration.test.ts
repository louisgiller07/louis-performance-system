/**
 * V2-PHYS-INTEGRATION-01 (HPM 2026-10-18) — the PHYS switches end to end on the LOCAL Supabase (real tables, real
 * RPCs, the Node path of the daily run).
 *
 * A. Every switch off = production: the same days computed by the production runtime (PHYS011_PREVIOUS_RUNTIME_ROOT,
 *    863f3fb, read-only) and by the candidate give the same decision and the same final prescription (ids aside),
 *    after Force sets were recorded (history a guidance would read) — Force, A10 Force, other families.
 * B. The PHYS daily switch: off → no cool-down and no guidance stored, even with recorded sets; on → cool-down and the
 *    Force session at the same dose under A10, still no load guidance; on with the performance guidance → load
 *    guidance on the recorded exercise.
 * C. Manual sessions of a PHYS family, OFF → ON → OFF: refused, then created, then refused again; the document created
 *    while on is never rewritten and its guided session still starts and completes.
 * D. A plan generated with power on, then power off: the planned power session keeps its document (KEEP), a manual
 *    power session is refused — closing a family never breaks the accepted plan.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestAthlete, createTestClient, getAthleteAuthClient, insertCheckin, setAthleteDiscipline } from "./testDb.js";
import { localIntegrationRequested } from "./localDb.js";
import { upsertPerformanceProfileFor } from "../../src/supabase/repositories/athletePerformanceProfileRepo.js";
import { insertAvailabilityWindow } from "../../src/supabase/repositories/athleteAvailabilityWindowsRepo.js";
import { buildPlanInputSnapshotV2 } from "../../src/supabase/buildPlanInputSnapshotV2.js";
import { generateAndPersistTrainingPlanV2, generateTrainingPlanVersionRpcV2 } from "../../src/generation/v2/generateAndPersistTrainingPlanV2.js";
import { acceptTrainingPlanVersion } from "../../src/supabase/acceptTrainingPlanVersion.js";
import { DEFAULT_RUN_DAILY_FOR_DEPS, runDailyFor } from "../../src/supabase/runDailyFor.js";

const ENABLED = localIntegrationRequested();
const PREVIOUS = process.env.PHYS011_PREVIOUS_RUNTIME_ROOT;
const OFF = DEFAULT_RUN_DAILY_FOR_DEPS;
const withPhys = (physSwitches: NonNullable<typeof DEFAULT_RUN_DAILY_FOR_DEPS.physSwitches>) => ({ ...DEFAULT_RUN_DAILY_FOR_DEPS, physSwitches });

type Item = { kind: string; prescriptionItemId: string; exerciseId?: string; sets?: number; measure: { type: string; min?: number; max?: number }; loadGuidance?: unknown; repsGuidance?: unknown };
type Structure = { family: string; sessionKind: string; blocks: { role: string; items: Item[] }[]; enduranceGuidance?: unknown };
type Final = { id: string; structure: Structure; reconciliation_action: string; adaptation_rule_ids: string[]; active_session_origin: string };

/** Every UUID replaced by its order of appearance: two documents are compared without their ids. */
function withoutIds(value: unknown): unknown {
  const seen = new Map<string, string>();
  return JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => {
    const key = id.toLowerCase();
    if (!seen.has(key)) seen.set(key, `id-${seen.size + 1}`);
    return seen.get(key)!;
  }));
}
const work = (s: Structure) => s.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items).filter((i) => i.kind === "exercise");

describe.skipIf(!ENABLED)("V2-PHYS-INTEGRATION-01 — PHYS switches (local Supabase)", { timeout: 300_000 }, () => {
  let admin: SupabaseClient;
  beforeAll(() => {
    admin = createTestClient();
  });

  async function rider(name: string, options: { powerSessions?: boolean } = {}) {
    const { athleteId } = await createTestAthlete(admin, `PHYS switches ${name} ${randomUUID().slice(0, 6)}`);
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
      { planningModel: "v2", client: admin, athleteId, generationRequestId: randomUUID(), durationWeeks: 6, today: "2026-10-04", ...options },
      { buildPlanInputSnapshotV2, callRpc: generateTrainingPlanVersionRpcV2, mintId: () => randomUUID() }
    );
    if (persisted.status !== "persisted") throw new Error("plan");
    await acceptTrainingPlanVersion(admin, athleteId, persisted.planVersionId, "2026-10-05", "2026-11-15");
    const { data } = await admin.from("training_plan_generated_sessions").select("date, kind, load_profile, duration_min").eq("plan_version_id", persisted.planVersionId).order("date");
    return { athleteId, sessions: (data ?? []) as { date: string; kind: string; load_profile: string | null; duration_min: number | null }[] };
  }
  const finalOf = async (decisionId: string) => {
    const { data } = await admin.from("decision_final_prescriptions").select("id, structure, reconciliation_action, adaptation_rule_ids, active_session_origin").eq("decision_id", decisionId).maybeSingle();
    return data as Final | null;
  };
  async function record(athleteId: string, payload: unknown) {
    const { data, error } = await admin.rpc("record_session_execution", { p_athlete_id: athleteId, p_payload: payload });
    if (error) throw new Error(error.message);
    return data as { status: string; code?: string };
  }
  /** A guided Force session of `date`, every work set recorded at the top of its range with a load (a history the load guidance reads). */
  async function doForce(athleteId: string, date: string, f: Final, loadKg = 16) {
    const id = randomUUID();
    expect(await record(athleteId, { execution: { id, session_date: date, started_at: `${date}T17:00:00Z`, final_prescription_id: f.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${date}T17:00:00Z` }] })).toMatchObject({ status: "ok" });
    const sets = work(f.structure).flatMap((item) =>
      Array.from({ length: item.sets ?? 1 }, (_, i) => ({
        id: randomUUID(),
        execution_id: id,
        prescription_item_id: item.prescriptionItemId,
        set_number: i + 1,
        done: true,
        measure_type: item.measure.type,
        measure_value: item.measure.max ?? 8,
        ...(item.measure.type === "reps" ? { load_kg: loadKg, rpe_actual: 7 } : {}),
        occurred_at: `${date}T17:${String(10 + i).padStart(2, "0")}:00Z`,
      }))
    );
    expect(await record(athleteId, { sets, events: [{ id: randomUUID(), execution_id: id, event_type: "completed", occurred_at: `${date}T18:00:00Z` }] })).toMatchObject({ status: "ok" });
  }
  const forceDays = (r: Awaited<ReturnType<typeof rider>>) => r.sessions.filter((s) => s.kind === "STRENGTH_LOWER" || s.kind === "STRENGTH_UPPER").map((s) => s.date);

  it.skipIf(!PREVIOUS)("A — every switch off: the production runtime and the candidate decide the same days the same way (ids aside)", async () => {
    const previousRunDailyFor = (await import(pathToFileURL(join(PREVIOUS!, "head-coach-engine", "dist", "supabase", "runDailyFor.js")).href)).runDailyFor as typeof runDailyFor;
    const r = await rider("A");
    const [first, second] = forceDays(r);
    // History: the first Force session done with loads (what a guidance would read).
    await insertCheckin(admin, r.athleteId, first!);
    const done = await runDailyFor(admin, r.athleteId, first!, OFF);
    await doForce(r.athleteId, first!, (await finalOf(done.persistence.decision_id))!);

    const days = [second!, ...r.sessions.filter((s) => s.kind !== "REST" && s.date > first! && s.date !== second).slice(0, 4).map((s) => s.date)];
    for (const [i, date] of days.entries()) {
      // The second Force day under the rider's time (A10): 30 minutes.
      await insertCheckin(admin, r.athleteId, date, i === 0 ? { available_minutes_today: 30 } : {});
      const prod = await previousRunDailyFor(admin, r.athleteId, date);
      const cand = await runDailyFor(admin, r.athleteId, date, OFF);
      expect([cand.dailyPlan.decision, cand.dailyPlan.final_session, cand.finalPrescriptionStatus], date).toEqual([prod.dailyPlan.decision, prod.dailyPlan.final_session, prod.finalPrescriptionStatus]);
      const [p, c] = [await finalOf(prod.persistence.decision_id), await finalOf(cand.persistence.decision_id)];
      expect(withoutIds(c && { ...c, id: null }), date).toEqual(withoutIds(p && { ...p, id: null }));
      if (c) expect(JSON.stringify(c.structure), `${date} no guidance`).not.toMatch(/loadGuidance|repsGuidance|enduranceGuidance/);
    }
  });

  it("B — PHYS daily switch: off → nothing new stored; on → cool-down, no load guidance; on + performance guidance → load guidance", async () => {
    const r = await rider("B");
    const [first, d2, d3, d4] = forceDays(r);
    await insertCheckin(admin, r.athleteId, first!);
    const done = await runDailyFor(admin, r.athleteId, first!, OFF);
    const firstFinal = (await finalOf(done.persistence.decision_id))!;
    expect(firstFinal.structure.blocks.map((b) => b.role)).not.toContain("cool_down");
    await doForce(r.athleteId, first!, firstFinal);

    // Off: no cool-down, no guidance, although sets are recorded.
    await insertCheckin(admin, r.athleteId, d2!);
    const off = (await finalOf((await runDailyFor(admin, r.athleteId, d2!, OFF)).persistence.decision_id))!;
    expect(off.structure.blocks.map((b) => b.role)).not.toContain("cool_down");
    expect(JSON.stringify(off.structure)).not.toMatch(/loadGuidance|repsGuidance|enduranceGuidance/);

    // Daily on, performance guidance off: the PHYS-01.1 cool-down, never a load guidance.
    await insertCheckin(admin, r.athleteId, d3!);
    const daily = (await finalOf((await runDailyFor(admin, r.athleteId, d3!, withPhys({ daily: true }))).persistence.decision_id))!;
    expect(daily.structure.blocks.at(-1)?.role).toBe("cool_down");
    expect(JSON.stringify(daily.structure)).not.toMatch(/loadGuidance|repsGuidance/);

    // Daily on + performance guidance on: the load guidance on the exercises recorded before (same catalogue id).
    await insertCheckin(admin, r.athleteId, d4!);
    const perf = (await finalOf((await runDailyFor(admin, r.athleteId, d4!, withPhys({ daily: true, performanceGuidance: true }))).persistence.decision_id))!;
    expect(JSON.stringify(perf.structure)).toMatch(/loadGuidance/);
    // The performance switch alone does nothing (it needs the daily switch): the env reader enforces it too.
    const { physSwitchesFromEnv } = await import("../../src/supabase/dailyV2/physDailySwitches.js");
    expect(physSwitchesFromEnv((n) => (n === "NALYNT_V2_PHYS_PERFORMANCE_GUIDANCE_ENABLED" ? "true" : undefined))).toEqual({ daily: false, performanceGuidance: false, intervals: false, power: false, mobility: false });
  });

  it("C — manual sessions of a PHYS family, OFF → ON → OFF: refused, created, refused; the document created while on is never rewritten and its session runs", async () => {
    const r = await rider("C");
    /** The next calendar day inside the accepted plan (a manual session replaces whatever was planned that day). */
    const free = (from: string) => new Date(new Date(`${from}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    const client = await getAthleteAuthClient(r.athleteId);
    const manual = async (date: string, intervention: Record<string, unknown>, session_type: string) => {
      const { error } = await client
        .from("planned_sessions")
        .upsert({ athlete_id: r.athleteId, planned_date: date, session_type, intervention, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
      if (error) throw new Error(error.message);
    };
    const cases = [
      { kind: "POWER", intervention: { kind: "POWER", load_profile: "MODERATE" }, sessionType: "STRENGTH_B", on: { power: true }, family: "power" },
      { kind: "AEROBIC_INTERVALS", intervention: { kind: "AEROBIC_INTERVALS", load_profile: "MODERATE" }, sessionType: "AEROBIC_INTERVALS", on: { intervals: true }, family: "endurance" },
      { kind: "MOBILITY", intervention: { kind: "MOBILITY" }, sessionType: "RECOVERY", on: { mobility: true }, family: "mobility" },
    ];
    let day = "2026-10-05";
    for (const c of cases) {
      // OFF: refused as before PHYS.
      day = free(day);
      await manual(day, c.intervention, c.sessionType);
      await insertCheckin(admin, r.athleteId, day);
      const refused = await runDailyFor(admin, r.athleteId, day, OFF);
      expect([refused.finalPrescriptionStatus, await finalOf(refused.persistence.decision_id)], `${c.kind} off`).toEqual(["blocked", null]);
      // ON (its own switch): created, manual contract.
      day = free(day);
      await manual(day, c.intervention, c.sessionType);
      await insertCheckin(admin, r.athleteId, day);
      const onRun = await runDailyFor(admin, r.athleteId, day, withPhys(c.on));
      const created = (await finalOf(onRun.persistence.decision_id))!;
      expect([onRun.finalPrescriptionStatus, created.structure.family, created.active_session_origin], `${c.kind} on`).toEqual(["created", c.family, "manual_override_new_kind"]);
      // OFF again, the next day: refused; the document of the ON day is untouched and its guided session runs.
      const onDay = day;
      day = free(day);
      await manual(day, c.intervention, c.sessionType);
      await insertCheckin(admin, r.athleteId, day);
      expect((await runDailyFor(admin, r.athleteId, day, OFF)).finalPrescriptionStatus, `${c.kind} off again`).toBe("blocked");
      expect(withoutIds(await finalOf(onRun.persistence.decision_id))).toEqual(withoutIds(created));
      const id = randomUUID();
      expect(await record(r.athleteId, { execution: { id, session_date: onDay, started_at: `${onDay}T17:00:00Z`, final_prescription_id: created.id }, events: [{ id: randomUUID(), execution_id: id, event_type: "started", occurred_at: `${onDay}T17:00:00Z` }] }), `${c.kind} start`).toMatchObject({ status: "ok" });
    }
  });

  it("D — plan generated with power on, then power off: the planned power session keeps its document (KEEP); a manual power session is refused", async () => {
    const r = await rider("D", { powerSessions: true });
    const power = r.sessions.find((s) => s.kind === "POWER");
    expect(power, "a power session in the plan").toBeDefined();
    await insertCheckin(admin, r.athleteId, power!.date);
    const kept = await runDailyFor(admin, r.athleteId, power!.date, OFF);
    const f = (await finalOf(kept.persistence.decision_id))!;
    expect([kept.dailyPlan.decision, kept.finalPrescriptionStatus, f.structure.family, f.reconciliation_action]).toEqual(["KEEP", "created", "power", "keep"]);
    // The same rider adds a manual power session on another day, power off: refused, as before PHYS.
    const other = r.sessions.find((s) => s.date > power!.date && s.kind !== "POWER")!.date;
    const client = await getAthleteAuthClient(r.athleteId);
    const { error } = await client
      .from("planned_sessions")
      .upsert({ athlete_id: r.athleteId, planned_date: other, session_type: "STRENGTH_B", intervention: { kind: "POWER", load_profile: "MODERATE" }, planned_intent: null, source: "manual", is_committed: false, source_plan_version_id: null, source_generated_session_id: null }, { onConflict: "athlete_id,planned_date" });
    if (error) throw new Error(error.message);
    await insertCheckin(admin, r.athleteId, other);
    const manual = await runDailyFor(admin, r.athleteId, other, OFF);
    expect([manual.finalPrescriptionStatus, await finalOf(manual.persistence.decision_id)]).toEqual(["blocked", null]);
  });
});
