import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePlanV2InMemory, RPE_SEMANTICS_V2, type PlanInputSnapshotV2, type PlanV2InMemory } from "planning-engine/session-model-v2";
import { planV2ToPersistencePayload } from "../../src/generation/v2/planV2PersistencePayload.js";
import { getCompletedStrengthSetHistory, type StrengthSetHistoryRead } from "../../src/supabase/repositories/strengthSetHistoryRepo.js";
import { getCompletedEnduranceActivityHistory, type EnduranceActivityHistoryRead } from "../../src/supabase/repositories/enduranceActivityHistoryRepo.js";
import { toStrengthHistoryByExercise } from "../../src/supabase/dailyV2/strengthLoadGuidance.js";
import { toEnduranceSessionRecords } from "../../src/supabase/dailyV2/enduranceGuidance.js";

// V2-CONTRACTS-INTEGRATION-01 (HPM 2026-10-26) — the real V2 consumers around the contracts: the persisted plan
// payload ignores the in-memory contract checks; the daily guidance readers read the set RPE and the activity RPE
// where RPE_SEMANTICS_V2 records them, never the V1 session RPE, and pass the values through unconverted; a
// completed execution's document and results are read, never written.

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as 0, startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail", "technical_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
};
const CONTEXT = { athleteId: "athlete-1", generationRequestId: "req-1", snapshot: SNAPSHOT, inputSnapshotHash: "hash", generationTrigger: "initial" as const, rationale: "Initial training plan generation." };

function plan(): PlanV2InMemory {
  let n = 0;
  const result = generatePlanV2InMemory({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" },
    snapshot: SNAPSHOT,
    mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  if (result.status !== "generated") throw new Error("expected a generated plan");
  return result.plan;
}

/** A read-only client double: records every table and selected columns, answers with the given rows. */
function recordingClient(rows: Record<string, unknown[]>) {
  const selects: { table: string; columns: string }[] = [];
  const client = {
    from(table: string) {
      const builder = {
        select(columns: string) {
          selects.push({ table, columns });
          return builder;
        },
        eq: () => builder,
        not: () => builder,
        gte: () => builder,
        lt: () => builder,
        in: () => builder,
        order: () => builder,
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, selects };
}

const columnsOf = (selects: { table: string; columns: string }[], table: string) => selects.filter((s) => s.table === table).flatMap((s) => s.columns.split(",").map((c) => `${table}.${c.trim()}`));

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("V2-CONTRACTS-INTEGRATION-01 · persisted plan unchanged", () => {
  it("V2 ON: the RPC payload is the same with or without the in-memory contract checks, and no row carries them", () => {
    const p = plan();
    expect(p.weeks.flatMap((w) => w.sessions).every((s) => s.contractChecks !== undefined)).toBe(true);
    const stripped = { ...p, weeks: p.weeks.map((w) => ({ ...w, sessions: w.sessions.map(({ contractChecks: _checks, ...s }) => s) })) } as unknown as PlanV2InMemory;
    const payload = planV2ToPersistencePayload(p, CONTEXT);
    expect(payload).toEqual(planV2ToPersistencePayload(stripped, CONTEXT));
    expect(JSON.stringify(payload)).not.toContain("contractChecks");
  });
});

describe("V2-CONTRACTS-INTEGRATION-01 · the three RPEs at the readers", () => {
  const execution = { id: "ex-1", session_date: "2026-10-13", final_prescription_id: "fp-1", execution_events: [{ event_type: "completed" }], decision_final_prescriptions: { structure: { family: "endurance", protocolId: "aerobic_base_v1", blocks: [] } } };

  it("the set RPE is read from exercise_set_results, the activity RPE from session_activity_results — as RPE_SEMANTICS_V2 records them", async () => {
    const strength = recordingClient({ session_executions: [execution], exercise_set_results: [] });
    await getCompletedStrengthSetHistory(strength.client, "athlete-1", ["dumbbell_bench_press"], "2026-08-25", "2026-10-20");
    expect(columnsOf(strength.selects, "exercise_set_results")).toContain(RPE_SEMANTICS_V2.set.recordedIn);
    expect(strength.selects.map((s) => s.table)).toEqual(["session_executions", "exercise_set_results"]);

    const endurance = recordingClient({ session_executions: [execution], session_activity_results: [] });
    await getCompletedEnduranceActivityHistory(endurance.client, "athlete-1", "2026-09-22", "2026-10-20");
    expect(columnsOf(endurance.selects, "session_activity_results")).toContain(RPE_SEMANTICS_V2.activity.recordedIn);
    expect(endurance.selects.map((s) => s.table)).toEqual(["session_executions", "session_activity_results"]);
  });

  it("the V1 session RPE (completed_sessions.rpe, 0–10) is read by no V2 daily module nor V2 history reader", () => {
    expect(RPE_SEMANTICS_V2.session).toMatchObject({ recordedIn: "completed_sessions.rpe", collectedInV2: false, progressionUse: "none" });
    const SRC = fileURLToPath(new URL("../../src/supabase", import.meta.url));
    const files = [
      ...readdirSync(`${SRC}/dailyV2`).map((f) => `dailyV2/${f}`),
      "repositories/strengthSetHistoryRepo.ts",
      "repositories/enduranceActivityHistoryRepo.ts",
    ];
    expect(files.filter((f) => readFileSync(`${SRC}/${f}`, "utf8").includes("completed_sessions"))).toEqual([]);
  });

  it("values pass through unconverted (no rescale, no rounding); a missing RPE stays missing", () => {
    const strength: StrengthSetHistoryRead = {
      executions: [{ executionId: "ex-1", sessionDate: "2026-10-13", structure: { blocks: [] } }],
      sets: [
        { id: "s1", execution_id: "ex-1", prescription_item_id: "i1", exercise_id: "dumbbell_bench_press", set_number: 1, done: true, measure_type: "reps", measure_value: 8, load_kg: "20.00", rpe_actual: "8.5", supersedes_id: null },
        { id: "s2", execution_id: "ex-1", prescription_item_id: "i1", exercise_id: "dumbbell_bench_press", set_number: 2, done: true, measure_type: "reps", measure_value: 8, load_kg: "20.00", rpe_actual: 10, supersedes_id: null },
        { id: "s3", execution_id: "ex-1", prescription_item_id: "i1", exercise_id: "dumbbell_bench_press", set_number: 3, done: true, measure_type: "reps", measure_value: 7, load_kg: "20.00", rpe_actual: null, supersedes_id: null },
      ],
    };
    expect(toStrengthHistoryByExercise(strength).dumbbell_bench_press![0]!.sets.map((s) => s.rpe)).toEqual([8.5, 10, null]);

    const endurance = (rpe: string | number | null): EnduranceActivityHistoryRead => ({
      executions: [{ executionId: "ex-1", sessionDate: "2026-10-13", structure: { family: "endurance", protocolId: "aerobic_base_v1" } }],
      activities: [{ id: "a1", execution_id: "ex-1", activity_id: "road_bike", duration_seconds: 3600, distance_m: null, rpe_actual: rpe, supersedes_id: null }],
    });
    expect([toEnduranceSessionRecords(endurance("6.5"))[0]!.rpeActual, toEnduranceSessionRecords(endurance(1))[0]!.rpeActual, toEnduranceSessionRecords(endurance(null))[0]!.rpeActual]).toEqual([6.5, 1, null]);
  });

  it("a completed execution's document and results are read, never written (deep-frozen reads map unchanged)", () => {
    const read = deepFreeze<StrengthSetHistoryRead>({
      executions: [{ executionId: "ex-1", sessionDate: "2026-10-13", structure: { blocks: [] } }],
      sets: [{ id: "s1", execution_id: "ex-1", prescription_item_id: "i1", exercise_id: "dumbbell_bench_press", set_number: 1, done: true, measure_type: "reps", measure_value: 8, load_kg: "20.00", rpe_actual: "7", supersedes_id: null }],
    });
    const before = JSON.stringify(read);
    expect(toStrengthHistoryByExercise(read).dumbbell_bench_press).toHaveLength(1);
    const activities = deepFreeze<EnduranceActivityHistoryRead>({
      executions: [{ executionId: "ex-1", sessionDate: "2026-10-13", structure: { family: "endurance", protocolId: "aerobic_base_v1" } }],
      activities: [{ id: "a1", execution_id: "ex-1", activity_id: "road_bike", duration_seconds: 3600, distance_m: 25000, rpe_actual: 4, supersedes_id: null }],
    });
    expect(toEnduranceSessionRecords(activities)).toHaveLength(1);
    expect(JSON.stringify(read)).toBe(before);
  });
});
