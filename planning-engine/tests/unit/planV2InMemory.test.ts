import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  generatePlanV2InMemory,
  PLAN_DOSE_MODEL_V2,
  type ExerciseItemV2Content,
  type GeneratePlanV2InMemoryResult,
  type PlanInputSnapshotV2,
  type PlanV2InMemory,
} from "../../src/sessionModelV2/index.js";
import { runPlanningPipeline } from "../../src/pipeline/planningPipelineOrchestrator.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// UX-11A.5b.5a — in-memory V2 orchestration, end to end (no persistence).
// Fixture doses come from the PROVISIONAL V2 content; the assertions check
// that the orchestration applies it, not that the values are validated.

const ALL_TERRAIN = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];
const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));

function snapshot(overrides: Partial<PlanInputSnapshotV2> = {}): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ALL_TERRAIN,
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    dhTechnicalTier: "intermediate",
    ...overrides,
  };
}

const block = (startDate: string, endDate: string) => ({ sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate, endDate });
const TWO_WEEKS = block("2026-10-05", "2026-10-18");
const RACE = { eventName: "Swiss Cup", startDate: "2026-10-24", endDate: "2026-10-25", priority: "A" as const };
const RACE_PLAN = block("2026-10-05", "2026-10-25"); // development → taper → race

function counter(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function generated(result: GeneratePlanV2InMemoryResult): PlanV2InMemory {
  if (result.status !== "generated") throw new Error(`expected a generated plan, got ${JSON.stringify(result)}`);
  return result.plan;
}

const sessions = (plan: PlanV2InMemory) => plan.weeks.flatMap((w) => w.sessions.map((s) => ({ ...s, weekType: w.weekType })));
const exerciseIds = (s: ReturnType<typeof sessions>[number]) => s.plannedPrescription.structure.blocks.flatMap((b) => b.items.map((i) => (i as ExerciseItemV2Content).exerciseId));
const workItems = (s: ReturnType<typeof sessions>[number]) => s.plannedPrescription.structure.blocks.filter((b) => b.role !== "warm_up").flatMap((b) => b.items) as ExerciseItemV2Content[];

describe("A — development plan: every session kind gets a valid V2 prescription", () => {
  const plan = generated(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot(), mintId: counter() }));

  it("carries the V2 schema / planner / catalogue versions", () => {
    expect(plan).toMatchObject({
      planningModel: "v2",
      inputSnapshotSchemaVersion: "v2",
      prescriptionSchemaVersion: "v2",
      plannerVersion: "v2",
      catalogVersion: "session-model-v2.4",
    });
    expect(plan.catalog.planDosePolicy).toBe("plan-dose-policy-v2.2");
  });

  it("Force MODERATE 60 min, DH 6 passages, AEROBIC_BASE 45 min; N sessions → N V2 prescriptions", () => {
    const all = sessions(plan);
    expect(all.map((s) => s.kind).sort()).toEqual(["AEROBIC_BASE", "AEROBIC_BASE", "DH_TECHNICAL", "DH_TECHNICAL", "DH_TECHNICAL", "DH_TECHNICAL", "STRENGTH_LOWER", "STRENGTH_LOWER", "STRENGTH_UPPER", "STRENGTH_UPPER"]);
    for (const s of all) {
      expect(s.plannedPrescription.schemaVersion).toBe("v2");
      expect(s.plannedPrescription.structure.sessionKind).toBe(s.kind);
      if (s.kind.startsWith("STRENGTH")) {
        expect([s.loadProfile, s.durationMin]).toEqual(["MODERATE", 60]);
        expect(workItems(s)[0]!.sets).toBe(4);
      }
      if (s.kind === "DH_TECHNICAL") {
        expect(s.durationMin).toBe(90);
        expect(s.plannedPrescription.structure.blocks.find((b) => b.role === "main")!.items[0]).toMatchObject({ kind: "drill", measure: { type: "pass", count: 6 } });
      }
      if (s.kind === "AEROBIC_BASE") {
        expect(s.durationMin).toBe(45);
        expect(s.plannedPrescription.structure.blocks.map((b) => b.durationMinutes?.min)).toEqual([10, 30, 5]);
      }
    }
  });

  it("DH rotation restarts at 0 in this version and follows the declared priorities in plan date order", () => {
    const dh = sessions(plan).filter((s) => s.kind === "DH_TECHNICAL").sort((a, b) => a.date.localeCompare(b.date));
    expect(dh.map((s) => s.plannedPrescription.structure.intentId)).toEqual(["dh_corner_exit_speed", "dh_braking_control", "dh_corner_exit_speed", "dh_braking_control"]);
  });
});

describe("B — plan with a race: development → taper → race", () => {
  const plan = generated(generatePlanV2InMemory({ block: RACE_PLAN, snapshot: snapshot({ races: [RACE] }), mintId: counter() }));

  it("week types follow the current planner", () => {
    expect(plan.weeks.map((w) => w.weekType)).toEqual(["development", "taper", "race"]);
    expect(plan.weeks[2]!.sessions).toEqual([]);
  });

  it("taper: Force LIGHT 45 min, DH 4 passages, AEROBIC_BASE 45 min — never 30 min, never 3 passages", () => {
    const taper = plan.weeks[1]!.sessions;
    const strength = taper.find((s) => s.kind.startsWith("STRENGTH"))!;
    expect([strength.loadProfile, strength.durationMin]).toEqual(["LIGHT", 45]);
    const dh = taper.find((s) => s.kind === "DH_TECHNICAL")!;
    expect(dh.plannedPrescription.structure.blocks.find((b) => b.role === "main")!.items[0]).toMatchObject({ measure: { type: "pass", count: 4 } });
    const aerobic = taper.find((s) => s.kind === "AEROBIC_BASE")!;
    expect(aerobic.durationMin).toBe(45);
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/"count":3[,}]/);
    expect(sessions(plan).filter((s) => s.kind === "AEROBIC_BASE").map((s) => s.durationMin)).toEqual([45, 45]);
  });
});

describe("C — legacy history counter never changes V2 doses", () => {
  it("same snapshot except recentMissedOrReplacedCount 0 vs 5 → identical V2 sport content", () => {
    const quiet = generated(generatePlanV2InMemory({ block: RACE_PLAN, snapshot: snapshot({ races: [RACE] }), mintId: counter("a") }));
    const missed = generated(generatePlanV2InMemory({
      block: RACE_PLAN,
      snapshot: snapshot({ races: [RACE], recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 5, trailingVolumeMinutes: 0 } }),
      mintId: counter("b"),
    }));
    expect(missed.planSportFingerprint).toBe(quiet.planSportFingerprint);
    expect(sessions(missed).map((s) => [s.kind, s.loadProfile, s.durationMin])).toEqual(sessions(quiet).map((s) => [s.kind, s.loadProfile, s.durationMin]));
    expect(sessions(missed).some((s) => /missed or replaced/.test(s.rationale))).toBe(false);
  });

  it("DH and AEROBIC_BASE carry LoadDerivation's unadjusted baseline load (DB requires it for load-variable kinds): development MODERATE, taper LIGHT, history ignored", () => {
    for (const count of [0, 5]) {
      const p = generated(generatePlanV2InMemory({
        block: RACE_PLAN,
        snapshot: snapshot({ races: [RACE], recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: count, trailingVolumeMinutes: 0 } }),
        mintId: counter(),
      }));
      const loads = new Set(sessions(p).filter((s) => s.kind === "DH_TECHNICAL" || s.kind === "AEROBIC_BASE").map((s) => `${s.weekType}:${s.loadProfile}`));
      expect(loads).toEqual(new Set(["development:MODERATE", "taper:LIGHT"]));
    }
  });

  it("V1 keeps its history adjustment for the same inputs (35 / 50 / LIGHT, 5 passages)", () => {
    const v1 = runPlanningPipeline({
      block: { ...TWO_WEEKS, id: "b", planVersionId: "v" },
      races: [],
      availability: { windows: ALL_DAY, exceptions: [] },
      terrainAccess: ALL_TERRAIN,
      lockedDates: [],
      strengthExperienceTier: "intermediate",
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 5, trailingVolumeMinutes: 0 },
    });
    const all = v1.weeks.flatMap((w) => w.sessions);
    expect(new Set(all.filter((s) => s.kind === "AEROBIC_BASE").map((s) => s.durationMin))).toEqual(new Set([35]));
    expect(new Set(all.filter((s) => s.kind.startsWith("STRENGTH")).map((s) => `${s.loadProfile}/${s.durationMin}`))).toEqual(new Set(["LIGHT/50"]));
    expect(new Set(all.filter((s) => s.kind === "DH_TECHNICAL").map((s) => (s.doseTarget as { focusedRunsCount: number }).focusedRunsCount))).toEqual(new Set([5]));
  });
});

describe("D — DH preconditions only when the plan contains DH", () => {
  it("plan with DH sessions + dhTechnicalTier null → blocked before any prescription", () => {
    expect(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot({ dhTechnicalTier: null }), mintId: counter() })).toEqual({ status: "blocked", code: "missing_dh_technical_tier", detail: {} });
    expect(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot({ technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: [] } }), mintId: counter() })).toMatchObject({ status: "blocked", code: "missing_dh_priority_areas" });
    expect(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot({ terrainAccess: ["flow_trail"] }), mintId: counter() })).toMatchObject({ status: "blocked", code: "unavailable_dh_drill_terrain" });
  });

  it("plan without any DH session + dhTechnicalTier null → generated (60-min windows only: no DH fits)", () => {
    const short = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "09:00" }));
    const plan = generated(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot({ dhTechnicalTier: null, availability: { windows: short, exceptions: [] } }), mintId: counter() }));
    expect(sessions(plan).some((s) => s.kind === "DH_TECHNICAL")).toBe(false);
    expect(sessions(plan).length).toBeGreaterThan(0);
  });
});

describe("E — Force composition is stable over the whole version", () => {
  it("same kind → same template and exercises in development and taper; only the dose changes", () => {
    const plan = generated(generatePlanV2InMemory({ block: RACE_PLAN, snapshot: snapshot({ races: [RACE] }), mintId: counter() }));
    for (const kind of ["STRENGTH_LOWER", "STRENGTH_UPPER"] as const) {
      const ofKind = sessions(plan).filter((s) => s.kind === kind);
      expect(ofKind.length).toBeGreaterThan(0);
      expect(new Set(ofKind.map((s) => JSON.stringify([s.plannedPrescription.structure.templateId, exerciseIds(s)]))).size).toBe(1);
    }
    const lower = sessions(plan).filter((s) => s.kind === "STRENGTH_LOWER");
    expect(new Set(lower.map((s) => `${s.weekType}:${workItems(s)[0]!.sets}`))).toEqual(new Set(["development:4", "taper:3"]));
  });
});

describe("F — placement uses the V2 duration (policy before placement)", () => {
  // Taper week (race next week): Mon 90 min, Wed 60 min, Fri 30 min only.
  const windows: PlanInputAvailabilityWindow[] = [
    { dayOfWeek: 1, startTime: "18:00", endTime: "19:30" },
    { dayOfWeek: 3, startTime: "18:00", endTime: "19:00" },
    { dayOfWeek: 5, startTime: "18:00", endTime: "18:30" },
  ];
  const taperBlock = block("2026-10-12", "2026-10-25");

  it("V2: the 45-min taper AEROBIC_BASE is NOT placed in the 30-min slot (explicit unplaceable), Force is placed as 45 min", () => {
    const plan = generated(generatePlanV2InMemory({ block: taperBlock, snapshot: snapshot({ races: [RACE], availability: { windows, exceptions: [] } }), mintId: counter() }));
    const taper = plan.weeks[0]!;
    expect(taper.weekType).toBe("taper");
    expect(taper.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual([
      ["2026-10-12", "DH_TECHNICAL", 60],
      ["2026-10-14", expect.stringMatching(/^STRENGTH_/), 45],
    ]);
    expect(taper.relaxedConstraints).toEqual(expect.arrayContaining([expect.objectContaining({ domain: "aerobic" })]));
  });

  it("V1 keeps its legacy behaviour: the 30-min taper AEROBIC_BASE fits the Friday slot", () => {
    const v1 = runPlanningPipeline({
      block: { ...taperBlock, id: "b", planVersionId: "v" },
      races: [RACE],
      availability: { windows, exceptions: [] },
      terrainAccess: ALL_TERRAIN,
      lockedDates: [],
      strengthExperienceTier: "intermediate",
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
    });
    expect(v1.weeks[0]!.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual([
      ["2026-10-12", "DH_TECHNICAL", 60],
      ["2026-10-14", expect.stringMatching(/^STRENGTH_/), 45],
      ["2026-10-16", "AEROBIC_BASE", 30],
    ]);
  });

  it("UX-11A.5a.4.3 — the V2 DH duration comes from the plan dose policy only, never from the legacy LoadDerivation figure", () => {
    // A baseline carrying an arbitrary legacy DH duration does not change the V2 result.
    for (const [weekType, expected] of [["development", 90], ["taper", 60]] as const) {
      const resolved = PLAN_DOSE_MODEL_V2.resolveSessionLoad({
        kind: "DH_TECHNICAL",
        domain: "dh_technical",
        weekType,
        baseline: { loadProfile: "MODERATE", durationMin: 999, doseTarget: { domain: "dh_technical", skillTargets: [], focusedRunsCount: 99 } },
      });
      expect([resolved.durationMin, (resolved.doseTarget as { focusedRunsCount: number }).focusedRunsCount]).toEqual([expected, weekType === "development" ? 6 : 4]);
    }
  });

  it("the V2 dose model gives the final durations before placement", () => {
    expect(PLAN_DOSE_MODEL_V2.placementDurationMinByDomain("development")).toEqual({ strength: 60, dh_technical: 90, aerobic: 45 });
    expect(PLAN_DOSE_MODEL_V2.placementDurationMinByDomain("taper")).toEqual({ strength: 45, dh_technical: 60, aerobic: 45 });
    expect(PLAN_DOSE_MODEL_V2.placementDurationMinByDomain("race")).toBeNull();
  });
});

describe("G — determinism", () => {
  it("same snapshot + horizon + versions → same plan sport fingerprint, whatever the ids", () => {
    const a = generated(generatePlanV2InMemory({ block: RACE_PLAN, snapshot: snapshot({ races: [RACE] }), mintId: () => randomUUID() }));
    const b = generated(generatePlanV2InMemory({ block: RACE_PLAN, snapshot: snapshot({ races: [RACE] }), mintId: () => randomUUID() }));
    expect(a.planVersionId).not.toBe(b.planVersionId);
    expect(a.planSportFingerprint).toBe(b.planSportFingerprint);
    expect(sessions(a).map((s) => s.sportFingerprint)).toEqual(sessions(b).map((s) => s.sportFingerprint));
  });

  it("strengths / weaknesses never change the plan", () => {
    const a = generated(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot(), mintId: counter() }));
    const b = generated(generatePlanV2InMemory({
      block: TWO_WEEKS,
      snapshot: snapshot({ technicalPriorities: { strengths: [], weaknesses: ["jumps", "cornering"], priorityAreas: ["cornering", "braking"] } }),
      mintId: counter(),
    }));
    expect(b.planSportFingerprint).toBe(a.planSportFingerprint);
  });

  it("ids are all minted by the injected strategy (deterministic in tests)", () => {
    const a = generated(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot(), mintId: counter("x") }));
    const b = generated(generatePlanV2InMemory({ block: TWO_WEEKS, snapshot: snapshot(), mintId: counter("x") }));
    expect(a).toEqual(b);
    expect(a.planVersionId).toBe("x-1");
  });
});
