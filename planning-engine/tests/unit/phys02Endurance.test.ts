import { describe, expect, it } from "vitest";
import {
  assignPrescriptionIds,
  attachEnduranceGuidanceV2,
  buildAerobicBasePrescriptionV2Content,
  buildAerobicIntervalsPrescriptionV2Content,
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  buildSessionModelV2CatalogManifest,
  enduranceGuidanceV2,
  generatePlanV2InMemory,
  sportFingerprint,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type EnduranceSessionRecordV2,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import { PLAN_MISSED_SESSIONS_HOLD_V2 } from "../../src/catalog/planDosePolicyV2.js";
import { PROTOCOL_CATALOG_V2 } from "../../src/catalog/protocolCatalogV2.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// PHYS-02 — endurance and intervals: the catalogue intervals protocol in the existing
// format, placed in overload weeks with the server option only, one dose per day
// (never lighter, never shorter), and advice from the rider's recorded sessions.

const window = (start: string, end: string): PlanInputAvailabilityWindow[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: start, endTime: end }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: window("08:00", "20:00"), exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
};
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-11-15" };

function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}

function plan(snapshot: PlanInputSnapshotV2, enduranceIntervals?: boolean): PlanV2InMemory {
  const r = generatePlanV2InMemory({ block: BLOCK, snapshot, mintId: counter("a"), ...(enduranceIntervals !== undefined ? { enduranceIntervals } : {}) });
  if (r.status !== "generated") throw new Error(`expected a generated plan, got ${r.status}`);
  return r.plan;
}
const PLAN_OFF = plan(SNAPSHOT);
const PLAN_ON = plan(SNAPSHOT, true);

const AEROBIC = ["AEROBIC_BASE", "AEROBIC_INTERVALS"];
const aerobicByWeek = (p: PlanV2InMemory) => p.weeks.map((w) => w.sessions.filter((s) => AEROBIC.includes(s.kind)).map((s) => [s.kind, s.durationMin, s.loadProfile]));
const catalog = buildSessionModelV2CatalogManifest();
const intervalsContent = (ridingAvailable?: boolean) =>
  buildAerobicIntervalsPrescriptionV2Content({ sessionKind: "AEROBIC_INTERVALS", catalog, ...(ridingAvailable !== undefined ? { ridingAvailable } : {}) });

describe("PHYS-02 — the intervals session: the catalogue protocol in the existing format", () => {
  it("warm-up 15 min, 6 × (3 min at RPE 8) with 2 min easy between, cool-down 10 min: 53 min, existing block fields only", () => {
    const c = intervalsContent();
    const work = ["main", 3, 8, "instruction.endurance.intervals_work"];
    const easy = ["main", 2, null, "instruction.endurance.intervals_easy"];
    expect(c.blocks.map((b) => [b.role, b.durationMinutes!.max, b.rpeTarget?.max ?? null, b.instructionIds.join(",")])).toEqual([
      ["warm_up", 15, null, "instruction.endurance.activity_choice,instruction.endurance.warm_up_easy"],
      work, easy, work, easy, work, easy, work, easy, work, easy, work,
      ["cool_down", 10, null, "instruction.endurance.cool_down_easy"],
    ]);
    expect(c.blocks.every((b) => b.items.length === 0 && b.durationMinutes!.min === b.durationMinutes!.max)).toBe(true);
    expect(c.blocks.reduce((t, b) => t + b.durationMinutes!.max, 0)).toBe(PROTOCOL_CATALOG_V2.endurance_intervals_3min!.totalDurationMinutes.max);
    expect(c).toMatchObject({ family: "endurance", sessionKind: "AEROBIC_INTERVALS", intentId: "aerobic_repeat_efforts", protocolId: "endurance_intervals_3min" });
    expect(c.activitySelection).toEqual({ mode: "restricted", activityIds: ["road_bike", "mtb_rolling", "home_trainer", "running"] });
    // No intervals item, no variant, no heart rate / FTP / zone: only fields a previous reader knows.
    expect(JSON.stringify(c)).not.toMatch(/"intervals"|variant|repetitions|workSeconds|heart|ftp|zone|watt/i);
    expect(validatePrescriptionV2(assignPrescriptionIds(c, counter("i"))).ok).toBe(true);
  });

  it("always the protocol's 6 repetitions: the 4 × 3 min variant is never selected", () => {
    const works = intervalsContent().blocks.filter((b) => b.instructionIds.includes("instruction.endurance.intervals_work"));
    expect(works).toHaveLength(6);
    expect(works.every((b) => b.rpeTarget!.min === 8 && b.rpeTarget!.max === 8)).toBe(true);
  });

  it("a day without riding: the off-terrain activities only (BUG-V2-1)", () => {
    expect(intervalsContent(false).activitySelection).toEqual({ mode: "restricted", activityIds: ["home_trainer", "running"] });
  });

  it("another session kind is a contract error, never a silent session", () => {
    expect(() => buildAerobicIntervalsPrescriptionV2Content({ sessionKind: "AEROBIC_BASE", catalog })).toThrow(/does not cover session kind AEROBIC_BASE/);
  });
});

describe("PHYS-02 — plan placement (server option only)", () => {
  it("without the option: no intervals session and no new key — the plan the previous planner produced", () => {
    expect(JSON.stringify(PLAN_OFF)).not.toMatch(/AEROBIC_INTERVALS|endurance_intervals|intervalsPolicy|aerobicSessionKind/);
    expect(plan(SNAPSHOT, false)).toEqual(PLAN_OFF);
    expect(aerobicByWeek(PLAN_OFF)).toEqual([[["AEROBIC_BASE", 45, "LIGHT"]], [["AEROBIC_BASE", 45, "MODERATE"]], [["AEROBIC_BASE", 60, "MODERATE"]], [], [["AEROBIC_BASE", 60, "MODERATE"]], [["AEROBIC_BASE", 75, "MODERATE"]]]);
  });

  it("with the option: each overload week's endurance session is the intervals session; every other week and session unchanged", () => {
    expect(PLAN_ON.weeks.map((w) => w.doseSummary.progression!.role)).toEqual(["introduction", "build", "build_plus", "consolidation", "build", "build_plus"]);
    expect(aerobicByWeek(PLAN_ON)).toEqual([[["AEROBIC_BASE", 45, "LIGHT"]], [["AEROBIC_BASE", 45, "MODERATE"]], [["AEROBIC_INTERVALS", 53, "MODERATE"]], [], [["AEROBIC_BASE", 60, "MODERATE"]], [["AEROBIC_INTERVALS", 53, "MODERATE"]]]);
    // Not an endurance session: the same sport content in both plans.
    const others = (p: PlanV2InMemory) => p.weeks.flatMap((w) => w.sessions.filter((s) => !AEROBIC.includes(s.kind)).map((s) => s.sportFingerprint));
    expect(others(PLAN_ON)).toEqual(others(PLAN_OFF));
    expect([0, 1, 3, 4].map((i) => PLAN_ON.weeks[i]!.doseSummary)).toEqual([0, 1, 3, 4].map((i) => PLAN_OFF.weeks[i]!.doseSummary));
  });

  it("an intervals week says so: reason, phrase, target kind and duration, policy version", () => {
    const week = PLAN_ON.weeks[2]!;
    const progression = week.doseSummary.progression!;
    expect(progression.reasonCodes).toEqual(["cycle_progression", "endurance_intervals"]);
    expect(progression.targets).toMatchObject({ aerobicDurationMin: 53, aerobicSessionKind: "AEROBIC_INTERVALS" });
    expect(progression.intervalsPolicy).toBe("endurance-intervals-plan-v1");
    expect(week.rationale).toContain("This week's endurance session is an intervals session.");
    const s = week.sessions.find((x) => x.kind === "AEROBIC_INTERVALS")!;
    expect(s.plannedPrescription.structure.blocks.map((b) => b.durationMinutes!.max)).toEqual([15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10]);
    expect(validatePrescriptionV2(s.plannedPrescription.structure).ok).toBe(true);
  });

  it("intervals are never shortened: no 53-min window → the base endurance session that fits, adapted to availability", () => {
    const short = plan({ ...SNAPSHOT, availability: { windows: window("08:00", "08:50"), exceptions: [] } }, true);
    expect(aerobicByWeek(short)[2]).toEqual([["AEROBIC_BASE", 45, "MODERATE"]]);
    expect(short.weeks[2]!.doseSummary.progression!.reasonCodes).toContain("adapted_to_availability");
    expect(JSON.stringify(short)).not.toMatch(/AEROBIC_INTERVALS|endurance_intervals/);
  });

  it("missed sessions hold the first overload week at build: no intervals that week, the next cycle's overload week has them", () => {
    const held = plan({ ...SNAPSHOT, recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: PLAN_MISSED_SESSIONS_HOLD_V2, trailingVolumeMinutes: 0 } }, true);
    expect(held.weeks.map((w) => w.doseSummary.progression!.role)).toEqual(["introduction", "build", "build", "consolidation", "build", "build_plus"]);
    expect(aerobicByWeek(held).map((w) => w.map((s) => s[0]))).toEqual([["AEROBIC_BASE"], ["AEROBIC_BASE"], ["AEROBIC_BASE"], [], ["AEROBIC_BASE"], ["AEROBIC_INTERVALS"]]);
  });

  it("race-specific and taper weeks keep the base endurance session", () => {
    const race = plan({ ...SNAPSHOT, races: [{ name: "Race", startDate: "2026-11-14", endDate: "2026-11-15", priority: "A" }] as PlanInputSnapshotV2["races"] }, true);
    const roles = race.weeks.map((w) => w.doseSummary.progression!.role);
    expect(roles.slice(3)).toEqual(["race_specific", "taper", "race"]);
    expect(aerobicByWeek(race).slice(3, 5).map((w) => w.map((s) => s[0]))).toEqual([["AEROBIC_BASE"], ["AEROBIC_BASE"]]);
  });
});

// --- Daily -------------------------------------------------------------------

const INTERVALS = PLAN_ON.weeks[2]!.sessions.find((s) => s.kind === "AEROBIC_INTERVALS")!;
const BASE_60 = PLAN_ON.weeks[4]!.sessions.find((s) => s.kind === "AEROBIC_BASE")!;

function input(s: PlanSessionV2InMemory, decision: "KEEP" | "MODIFY" | "REPLACE", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"], ridingAvailable = true): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: PLAN_ON.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: PLAN_ON.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable, mintId: counter("b") },
  };
}
const KEEP_INTERVALS = { kind: "AEROBIC_INTERVALS", loadProfile: "MODERATE" as const, durationMin: 53 };

function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 & { effectiveDurationMin?: number } {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return { ...r.finalPrescription, ...(r.effectiveDurationMin !== undefined ? { effectiveDurationMin: r.effectiveDurationMin } : {}) };
}
const minutesOf = (p: PrescriptionV2) => p.blocks.map((b) => b.durationMinutes!.max);

describe("PHYS-02 — daily: the intervals session has one dose (never lighter, never shorter)", () => {
  it("KEEP: the planned intervals session, verbatim", () => {
    const f = created(buildFinalPrescriptionV2(input(INTERVALS, "KEEP", KEEP_INTERVALS)));
    expect(f.reconciliationAction).toBe("keep");
    expect(f.structure.blocks).toEqual(INTERVALS.plannedPrescription.structure.blocks);
  });

  it("MODIFY to LIGHT (C3.3 sleep, C3.6 legs, pain): no lighter intervals session — M1's decision kept without a document, the reason traced", () => {
    expect(buildFinalPrescriptionV2(input(INTERVALS, "MODIFY", { kind: "AEROBIC_INTERVALS", loadProfile: "LIGHT" }))).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "intervals_load_not_supported", planned: "MODERATE", final: "LIGHT" },
    });
  });

  it("MODIFY intervals → base, same load (MENTAL_RED): the base endurance session at the planned 53 min, the planned activity choice", () => {
    const f = created(buildFinalPrescriptionV2(input(INTERVALS, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "MODERATE" })));
    expect(f).toMatchObject({ reconciliationAction: "modify", adaptationRuleIds: ["v2.modify.intervals_to_base"], effectiveDurationMin: 53 });
    expect(f.structure).toMatchObject({ sessionKind: "AEROBIC_BASE", protocolId: "endurance_base_continuous", activitySelection: INTERVALS.plannedPrescription.structure.activitySelection });
    expect(minutesOf(f.structure)).toEqual([10, 38, 5]);
    expect(f.structure.blocks[1]!.rpeTarget).toEqual({ min: 3, max: 4 });
  });

  it("MODIFY intervals → base LIGHT (committed activity family): the LIGHT endurance duration, 45 min", () => {
    const f = created(buildFinalPrescriptionV2(input(INTERVALS, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT" })));
    expect([f.adaptationRuleIds, minutesOf(f.structure)]).toEqual([["v2.modify.intervals_to_base"], [10, 30, 5]]);
  });

  it("REPLACE by the intervals kind: the catalogue session at MODERATE; any other load is refused", () => {
    const f = created(buildFinalPrescriptionV2(input(BASE_60, "REPLACE", { kind: "AEROBIC_INTERVALS", loadProfile: "MODERATE" })));
    expect([f.reconciliationAction, f.adaptationRuleIds, minutesOf(f.structure)]).toEqual(["replace", ["v2.replace.intervals"], [15, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 10]]);
    expect(buildFinalPrescriptionV2(input(BASE_60, "REPLACE", { kind: "AEROBIC_INTERVALS", loadProfile: "LIGHT" }))).toMatchObject({ status: "blocked", detail: { reason: "intervals_load_not_supported" } });
  });

  it("A10 — 60 min today: the intervals session fits, unchanged", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(INTERVALS, "KEEP", KEEP_INTERVALS), availableMinutes: 60 });
    expect(r.timeConstraint?.action).toBe("fits");
    expect(created(r).structure.sessionKind).toBe("AEROBIC_INTERVALS");
  });

  it("A10 — 50 min today: intervals are never cut — the base endurance session at 45 min instead", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(INTERVALS, "KEEP", KEEP_INTERVALS), availableMinutes: 50 });
    const f = created(r);
    expect([f.reconciliationAction, f.structure.sessionKind, minutesOf(f.structure)]).toEqual(["replace", "AEROBIC_BASE", [10, 30, 5]]);
    expect(r.timeConstraint).toMatchObject({ action: "adapted", after: { decision: "REPLACE", kind: "AEROBIC_BASE", durationMin: 45 } });
    expect(JSON.stringify(f.structure)).not.toMatch(/intervals_work/);
  });

  it("A10 — 40 min today: active recovery (the existing last step)", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(INTERVALS, "KEEP", KEEP_INTERVALS), availableMinutes: 40 });
    expect(r.timeConstraint).toMatchObject({ action: "adapted", after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } });
  });

  it("A10 — a base session from an intervals one (53 min) with 50 min today: 45 min, the minimum off the 15-min grid", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(INTERVALS, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "MODERATE" }), availableMinutes: 50 });
    expect(minutesOf(created(r).structure)).toEqual([10, 30, 5]);
    expect(r.timeConstraint).toMatchObject({ action: "adapted", after: { kind: "AEROBIC_BASE", durationMin: 45 } });
  });

  it("A10 on a planned base session: unchanged ladder (60 → 45 with 50 min)", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(BASE_60, "KEEP", { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 60 }), availableMinutes: 50 });
    expect([created(r).reconciliationAction, minutesOf(created(r).structure)]).toEqual(["modify", [10, 30, 5]]);
  });
});

// --- Guidance ---------------------------------------------------------------

const BASE_FINAL: PrescriptionV2 = assignPrescriptionIds(buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 60, catalog }), counter("g"));
const INTERVALS_FINAL: PrescriptionV2 = assignPrescriptionIds(intervalsContent(), counter("h"));
const rec = (sessionDate: string, protocolId: string, rpeActual: number | null, activityId = "mtb_rolling"): EnduranceSessionRecordV2 => ({ sessionDate, protocolId, activityId, durationSeconds: 3300, distanceM: 21000, rpeActual });

describe("PHYS-02 — endurance guidance from the rider's recorded sessions (advisory)", () => {
  it("the last session of the same protocol within 28 days, as recorded; other protocols, older, same-day and later sessions are ignored", () => {
    const history = [
      rec("2026-09-10", "endurance_base_continuous", 3),
      rec("2026-10-01", "endurance_base_continuous", 4, "road_bike"),
      rec("2026-10-08", "endurance_intervals_3min", 7),
      rec("2026-10-15", "endurance_base_continuous", 2),
    ];
    expect(enduranceGuidanceV2({ date: "2026-10-15", prescription: BASE_FINAL }, history)).toEqual({
      ruleVersion: "endurance-guidance-v1",
      reference: { sessionDate: "2026-10-01", activityId: "road_bike", durationSeconds: 3300, distanceM: 21000, rpeActual: 4 },
    });
    expect(enduranceGuidanceV2({ date: "2026-10-30", prescription: BASE_FINAL }, [rec("2026-10-01", "endurance_base_continuous", 4)])).toBeNull();
    expect(enduranceGuidanceV2({ date: "2026-10-15", prescription: BASE_FINAL }, [])).toBeNull();
  });

  it("base endurance: a recorded RPE above today's target is restated (RPE 6 for 3–4); at the target, nothing", () => {
    expect(enduranceGuidanceV2({ date: "2026-10-15", prescription: BASE_FINAL }, [rec("2026-10-10", "endurance_base_continuous", 6)])?.effortAboveTarget).toEqual({ rpeActual: 6, rpeTargetMax: 4 });
    expect(enduranceGuidanceV2({ date: "2026-10-15", prescription: BASE_FINAL }, [rec("2026-10-10", "endurance_base_continuous", 4)])).not.toHaveProperty("effortAboveTarget");
    expect(enduranceGuidanceV2({ date: "2026-10-15", prescription: BASE_FINAL }, [rec("2026-10-10", "endurance_base_continuous", null)])).not.toHaveProperty("effortAboveTarget");
  });

  it("intervals: reference only — the session RPE is never compared with the repetitions' RPE", () => {
    const g = enduranceGuidanceV2({ date: "2026-10-15", prescription: INTERVALS_FINAL }, [rec("2026-10-08", "endurance_intervals_3min", 9)]);
    expect(g).toEqual({ ruleVersion: "endurance-guidance-v1", reference: { sessionDate: "2026-10-08", activityId: "mtb_rolling", durationSeconds: 3300, distanceM: 21000, rpeActual: 9 } });
  });

  it("valid on a final endurance prescription only; strict shape; never sport content", () => {
    const g = enduranceGuidanceV2({ date: "2026-10-15", prescription: BASE_FINAL }, [rec("2026-10-10", "endurance_base_continuous", 6)])!;
    const guided = attachEnduranceGuidanceV2(BASE_FINAL, g);
    expect(validatePrescriptionV2(guided, { stage: "final" }).ok).toBe(true);
    expect(validatePrescriptionV2(guided)).toMatchObject({ ok: false, issues: [{ path: "$.enduranceGuidance", code: "endurance_guidance_not_allowed" }] });
    const bad = (patch: Record<string, unknown>) => validatePrescriptionV2({ ...guided, enduranceGuidance: { ...g, ...patch } }, { stage: "final" });
    expect(bad({ extra: 1 })).toMatchObject({ ok: false, issues: [{ code: "invalid_endurance_guidance" }] });
    expect(bad({ reference: { ...g.reference, activityId: "swimming" } })).toMatchObject({ ok: false, issues: [{ code: "invalid_endurance_guidance" }] });
    expect(bad({ effortAboveTarget: { rpeActual: 4, rpeTargetMax: 4 } })).toMatchObject({ ok: false, issues: [{ code: "invalid_endurance_guidance" }] });
    // Never a heart rate (nor FTP, watts, zone): refused at any depth, and outside the exact shape.
    expect(bad({ heartRate: 150 })).toEqual({
      ok: false,
      issues: [
        { path: "$.enduranceGuidance.heartRate", code: "forbidden_load_field" },
        { path: "$.enduranceGuidance", code: "invalid_endurance_guidance" },
      ],
    });
    expect(sportFingerprint(guided)).toBe(sportFingerprint(BASE_FINAL));
    expect(attachEnduranceGuidanceV2(BASE_FINAL, null)).toBe(BASE_FINAL);
  });
});
