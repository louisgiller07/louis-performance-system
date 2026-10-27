/**
 * V2-DH-SPORT-GATE-01C (HPM 2026-10-26) — the session-execution guard against a same-day revocation of a DH sports
 * validation (supabase/functions/session-execution/dhValidationGuard.ts), with the engine's real check:
 * - through the Node build with TEST sign-offs: valid at 09:00, then revoked;
 * - through the daily-run V2 bundle the Edge Function loads: the production tables, nothing signed.
 * Sign-offs are TEST fixtures routed through the REAL gate: not sports decisions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dhValidationRefusal, statesDhUnit, type DhValidationGuardReader, type ExecutionTable } from "../../../../supabase/functions/session-execution/dhValidationGuard.js";
import type { SessionExecutionBatch } from "../../../../supabase/functions/session-execution/validation.js";
import { dhSportValidationCurrentV2 } from "../../../dist/edge/dailyRunV2EdgeEntry.js";
import { generatePlanV2InMemory } from "../../../../planning-engine/dist/sessionModelV2/index.js";
import { dhServedCommonContentV2, dhServedSportContentV2 } from "../../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../../../planning-engine/dist/catalog/sessionDrillCatalogV2.js";

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown }));
vi.mock("../../../../planning-engine/dist/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<{ dhRepetitionUnitAttributionFromSignoffV2: (drillId: string, signoff: unknown, common: unknown) => unknown }>();
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => real.dhRepetitionUnitAttributionFromSignoffV2(drillId, fixture.signoffs[drillId], fixture.common) };
});

const TEST_DECISION = "TEST fixture V2-DH-SPORT-GATE-01C (not a sports decision)";
function signAll() {
  fixture.signoffs = Object.fromEntries(
    SESSION_DRILL_CATALOG_V2_ENTRIES.map((d: { drillId: string }) => {
      const s = dhServedSportContentV2(d.drillId)!;
      return [
        d.drillId,
        {
          unit: { decision: TEST_DECISION, unit: "SECTION" },
          cue: { decision: TEST_DECISION, drillName: s.drillName, cueText: s.cueText, criterionText: s.criterionText },
          dose: { decision: TEST_DECISION, doseTerms: s.doseTerms },
          safety: { decision: TEST_DECISION, vigilanceTexts: [...s.vigilanceTexts], regressesTo: s.regressesTo, terrains: [...s.terrains] },
        },
      ];
    })
  );
  fixture.common = { decision: TEST_DECISION, ...dhServedCommonContentV2()! };
}
const revokeAll = () => {
  fixture.signoffs = {};
};

type Structure = { family: string; blocks: { items: { kind: string; measure: Record<string, unknown> }[] }[] };
const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: "08:00", endTime: "20:00" }));
function documents(unit: "required" | undefined): { dh: Structure; force: Structure } {
  let n = 0;
  const r = generatePlanV2InMemory({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-11-02", endDate: "2026-11-29" },
    snapshot: {
      discipline: "Downhill",
      races: [],
      availability: { windows: ALL_DAY, exceptions: [] },
      equipment: ["dumbbells", "bench"],
      terrainAccess: ["flow_trail", "bermed_trail", "root_rock_trail", "technical_trail"],
      strengthExperienceTier: "intermediate",
      declaredLimitations: [],
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["roots_rocks"] },
      lockedDates: [],
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
      dhTechnicalTier: "intermediate",
    },
    mintId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    ...(unit ? { dhUnit: unit } : {}),
  } as Parameters<typeof generatePlanV2InMemory>[0]);
  if (r.status !== "generated") throw new Error(`expected a plan, got ${r.code}`);
  const sessions = r.plan.weeks.flatMap((w) => w.sessions);
  const structureOf = (kind: string) => sessions.find((s) => s.kind === kind)!.plannedPrescription.structure as unknown as Structure;
  return { dh: structureOf("DH_TECHNICAL"), force: structureOf("STRENGTH_LOWER") };
}

beforeEach(() => {
  fixture.signoffs = {};
  fixture.common = null;
});

describe("V2-DH-SPORT-GATE-01C · the engine's check of a stored document", () => {
  it("valid at 09:00 (complete TEST sign-off): executable; revoked later the same day: not executable; Force and a unit-less DH count: executable either way", () => {
    signAll();
    const signed = documents("required");
    const unitless = documents(undefined);
    revokeAll();
    const legacy = documents(undefined);
    expect(signed.dh.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")!.measure).toMatchObject({ unit: "SECTION" });
    expect(Object.keys(legacy.dh.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")!.measure).sort()).toEqual(["count", "type"]);

    signAll();
    expect(dhSportValidationCurrentV2(signed.dh)).toBe(true);
    revokeAll();
    expect(dhSportValidationCurrentV2(signed.dh)).toBe(false);
    for (const doc of [signed.force, legacy.dh, legacy.force]) expect(dhSportValidationCurrentV2(doc)).toBe(true);
    expect(statesDhUnit(signed.dh)).toBe(true);
    for (const doc of [signed.force, legacy.dh, unitless.force]) expect(statesDhUnit(doc)).toBe(false);
  });

  it("the daily-run V2 bundle the Edge Function loads (production tables, nothing signed): a SECTION document is not executable; Force and unit-less DH are", async () => {
    signAll();
    const signed = documents("required");
    revokeAll();
    const legacy = documents(undefined);
    const bundle = (await import("../../../dist/edge/dailyRunV2.bundle.js")) as { dhSportValidationCurrentV2: (s: unknown) => boolean };
    expect(bundle.dhSportValidationCurrentV2(signed.dh)).toBe(false);
    expect(bundle.dhSportValidationCurrentV2(signed.force)).toBe(true);
    expect(bundle.dhSportValidationCurrentV2(legacy.dh)).toBe(true);
  });
});

describe("V2-DH-SPORT-GATE-01C · the session-execution guard", () => {
  const FP_DH = "fp-dh";
  const FP_FORCE = "fp-force";
  const FP_UNITLESS = "fp-unitless";
  const STARTED = "exec-started-before-revocation";
  function reader(docs: Record<string, Structure>, recorded: Partial<Record<ExecutionTable, string[]>> = {}): DhValidationGuardReader & { reads: string[] } {
    const executions: Record<string, string> = { [STARTED]: FP_DH, "exec-force": FP_FORCE };
    const reads: string[] = [];
    return {
      reads,
      recorded: async (table, ids) => (reads.push(table), new Set(ids.filter((id) => (recorded[table] ?? []).includes(id)))),
      executionPrescriptions: async (ids) => (reads.push("executions"), new Map(ids.filter((id) => id in executions).map((id) => [id, executions[id]!]))),
      structures: async (ids) => (reads.push("structures"), new Map(ids.filter((id) => id in docs).map((id) => [id, docs[id]]))),
    };
  }
  const batch = (b: Partial<SessionExecutionBatch>): SessionExecutionBatch => ({ execution: null, events: [], sets: [], activities: [], ...b }) as SessionExecutionBatch;
  const execution = (id: string, fp: string) => ({ id, session_date: "2026-11-10", started_at: "2026-11-10T09:00:00Z", final_prescription_id: fp, comment: null });
  const event = (id: string, executionId: string, type: string) => ({ id, execution_id: executionId, event_type: type, occurred_at: "2026-11-10T10:00:00Z" }) as SessionExecutionBatch["events"][number];
  const pass = (id: string, executionId: string, extra: Record<string, unknown> = {}) => ({ id, execution_id: executionId, prescription_item_id: "item", set_number: 1, done: true, measure_type: "pass", success: true, ...extra }) as unknown as SessionExecutionBatch["sets"][number];
  const activity = (id: string, executionId: string) => ({ id, execution_id: executionId, activity_id: "road_bike", duration_seconds: 600 }) as unknown as SessionExecutionBatch["activities"][number];

  async function setting() {
    signAll();
    const signed = documents("required");
    revokeAll();
    const legacy = documents(undefined);
    const docs = { [FP_DH]: signed.dh, [FP_FORCE]: signed.force, [FP_UNITLESS]: legacy.dh };
    let loads = 0;
    const load = async () => (loads++, dhSportValidationCurrentV2);
    return { docs, load, loads: () => loads };
  }

  it("a new execution of the revoked DH document is refused; Force and a unit-less DH count are not, without even loading the engine check", async () => {
    const { docs, load, loads } = await setting();
    expect(await dhValidationRefusal(batch({ execution: execution("new", FP_DH), events: [event("e1", "new", "started")] }), reader(docs), load)).toBe(true);
    expect(loads()).toBe(1);
    for (const fp of [FP_FORCE, FP_UNITLESS]) expect(await dhValidationRefusal(batch({ execution: execution("new", fp), events: [event("e1", "new", "started")] }), reader(docs), load), fp).toBe(false);
    expect(loads()).toBe(1);
    // Valid again (the same document under a complete sign-off): nothing is refused.
    signAll();
    expect(await dhValidationRefusal(batch({ execution: execution("new", FP_DH), events: [event("e1", "new", "started")], sets: [pass("p1", "new")] }), reader(docs), load)).toBe(false);
  });

  it("an execution started before the revocation: paused and abandoned allowed; resumed, completed, a pass, a correction, an activity refused", async () => {
    const { docs, load } = await setting();
    for (const type of ["paused", "abandoned"]) expect(await dhValidationRefusal(batch({ events: [event("e", STARTED, type)] }), reader(docs), load), type).toBe(false);
    for (const type of ["resumed", "completed"]) expect(await dhValidationRefusal(batch({ events: [event("e", STARTED, type)] }), reader(docs), load), type).toBe(true);
    expect(await dhValidationRefusal(batch({ sets: [pass("p", STARTED)] }), reader(docs), load)).toBe(true);
    expect(await dhValidationRefusal(batch({ sets: [pass("c", STARTED, { supersedes_id: "p0" })] }), reader(docs), load)).toBe(true);
    expect(await dhValidationRefusal(batch({ activities: [activity("a", STARTED)] }), reader(docs), load)).toBe(true);
    expect(await dhValidationRefusal(batch({ sets: [pass("p", "exec-force")], events: [event("e", "exec-force", "resumed")] }), reader(docs), load)).toBe(false);
  });

  it("replays of ids already recorded are left to the RPC; an execution the rider cannot see is left to the RPC (execution_not_found)", async () => {
    const { docs, load } = await setting();
    const recorded = { session_executions: ["new"], execution_events: ["e1", "r1"], exercise_set_results: ["p1"] };
    expect(await dhValidationRefusal(batch({ execution: execution("new", FP_DH), events: [event("e1", "new", "started")] }), reader(docs, recorded), load)).toBe(false);
    expect(await dhValidationRefusal(batch({ events: [event("r1", STARTED, "resumed")], sets: [pass("p1", STARTED)] }), reader(docs, recorded), load)).toBe(false);
    // A replayed execution with a NEW result: the result is a training action on that execution's document.
    expect(await dhValidationRefusal(batch({ execution: execution("new", FP_DH), sets: [pass("p2", "new")] }), reader(docs, recorded), load)).toBe(true);
    expect(await dhValidationRefusal(batch({ sets: [pass("p3", "someone-elses-execution")] }), reader(docs), load)).toBe(false);
  });
});
