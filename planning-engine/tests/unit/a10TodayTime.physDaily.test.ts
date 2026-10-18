// V2-PHYS-INTEGRATION-01 — A10 with the PHYS daily switch ON (the PHYS-01.1 Force rules: same dose, cool-down, content's
// estimate). a10TodayTime.test.ts — the production test, unchanged — proves the same day with every switch off.
import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  DAILY_ADAPTATION_RULES_V2,
  estimateStrengthDurationMinutesV2,
  generatePlanV2InMemory,
  prescriptionMaxMinutes,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type DrillItemV2,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type FinalPrescriptionWithinTodayTimeV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// A10 — the rider's time today: no executable final prescription asks for more
// than the minutes given; only validated content, the load never going up.

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};

function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}

function plan(trailingVolumeMinutes: number, weeks = 2): PlanV2InMemory {
  const end = weeks === 2 ? "2026-10-18" : "2026-10-25";
  const r = generatePlanV2InMemory({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: end },
    snapshot: { ...SNAPSHOT, recentHistory: { ...SNAPSHOT.recentHistory, trailingVolumeMinutes } },
    mintId: counter("a"),
  });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  return r.plan;
}
const BUILD = plan(240, 3); // build, build+, … : MODERATE doses
const INTRO = plan(0); // introduction week first: LIGHT doses

function find(p: PlanV2InMemory, kind: string, durationMin?: number): PlanSessionV2InMemory {
  const s = p.weeks.flatMap((w) => w.sessions).find((x) => x.kind === kind && (durationMin === undefined || x.durationMin === durationMin));
  if (!s) throw new Error(`no ${kind} ${durationMin ?? ""}`);
  return s;
}

function input(
  s: PlanSessionV2InMemory,
  p: PlanV2InMemory,
  availableMinutes: number | null,
  over: { decision?: "KEEP" | "MODIFY" | "REPLACE" | "REST"; finalSession?: BuildFinalPrescriptionV2Input["decision"]["finalSession"]; ridingAvailable?: boolean } = {}
): BuildFinalPrescriptionV2Input & { availableMinutes: number | null } {
  return {
    availableMinutes,
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision: over.decision ?? "KEEP", finalSession: over.finalSession ?? { kind: s.kind, loadProfile: s.loadProfile!, durationMin: s.durationMin } },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: p.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: p.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable: over.ridingAvailable ?? true, mintId: counter("b") },
    // PHYS-01.1 — with the PHYS daily switch on, the daily runtime passes it: every Force final prescription ends with its cool-down.
    dailyMintId: counter("c"),
    // V2-PHYS-INTEGRATION-01 — these are the PHYS-01.1 rules: the PHYS daily switch on (a10TodayTime.test.ts: off).
    phys: { daily: true },
  };
}
const roles = (f: FinalPrescriptionV2) => f.structure.blocks.map((b) => [b.role, b.items.map((i) => (i.kind === "exercise" ? i.exerciseId : i.drillId))]);

function created(r: FinalPrescriptionWithinTodayTimeV2Result): Extract<FinalPrescriptionWithinTodayTimeV2Result, { status: "created" }> {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r;
}
const valid = (f: FinalPrescriptionV2) => expect(validatePrescriptionV2(f.structure, { stage: "final" })).toMatchObject({ ok: true });
const drill = (f: FinalPrescriptionV2) => f.structure.blocks.find((b) => b.role === "main")!.items[0] as DrillItemV2;

describe("A10 — no time given, or enough time: unchanged", () => {
  it("A — no time given: exactly A04's result, no constraint outcome", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const { availableMinutes: _x, ...base } = input(s, BUILD, null);
    expect(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, null))).toEqual(buildFinalPrescriptionV2(base));
  });

  it("B — 90 min for a 60-min Force slot: KEEP (the planned content and its cool-down), « fits », at the content's estimated duration (PHYS-01.1: 51 min)", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 90)));
    expect(r.finalPrescription).toMatchObject({ reconciliationAction: "keep", adaptationRuleIds: [] });
    expect([r.effectiveDurationMin, estimateStrengthDurationMinutesV2(r.finalPrescription.structure)]).toEqual([51, 51]);
    expect(r.timeConstraint).toMatchObject({ availableMinutes: 90, action: "fits", before: { decision: "KEEP", durationMin: 51 } });
  });

  it("exactly the session's estimated duration fits (≤, not <); one minute less shortens it", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    expect(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 51)).timeConstraint?.action).toBe("fits");
    expect(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 50)).timeConstraint?.action).toBe("adapted");
  });
});

describe("A10 — Force (PHYS-01.1): the same session at the same dose, shortened, never a dose change for time", () => {
  /** Exact sets / measure / RPE / rest of every work item: what « same dose » means. */
  const doses = (f: FinalPrescriptionV2) =>
    f.structure.blocks
      .filter((b) => b.role === "main" || b.role === "complementary")
      .flatMap((b) => b.items)
      .map((i) => (i.kind === "exercise" ? [i.exerciseId, i.sets, i.measure, i.rpeTarget, i.restSeconds] : null));

  it("C — Force 60 + 45 min: MODIFY at the SAME dose — every work exercise kept, the cool-down reduced to its mobility — 45 min", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const keep = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 90)));
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 45)));
    expect(r.finalPrescription).toMatchObject({ reconciliationAction: "modify", adaptationRuleIds: [DAILY_ADAPTATION_RULES_V2.strengthShortened, DAILY_ADAPTATION_RULES_V2.todayTimeLimit] });
    expect(doses(r.finalPrescription)).toEqual(doses(keep.finalPrescription));
    expect(roles(r.finalPrescription)).toEqual([
      ["warm_up", ["hip_90_90", "knee_to_wall_ankle", "bird_dog"]],
      ["main", ["goblet_squat"]],
      ["complementary", ["dumbbell_romanian_deadlift"]],
      ["complementary", ["bulgarian_split_squat"]],
      ["cool_down", ["hip_flexor_mobility"]],
    ]);
    expect([r.effectiveDurationMin, r.timeConstraint?.action, r.timeConstraint?.after]).toEqual([45, "adapted", { decision: "MODIFY", kind: s.kind, loadProfile: "MODERATE", durationMin: 45 }]);
    valid(r.finalPrescription);
  });

  it("D — Force 60 + 30 min: the principal alone at its planned dose, full warm-up, the cool-down's mobility — 29 min; lineage by exercise", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const keep = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 90)));
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30)));
    expect(roles(r.finalPrescription)).toEqual([
      ["warm_up", ["hip_90_90", "knee_to_wall_ankle", "bird_dog"]],
      ["main", ["goblet_squat"]],
      ["cool_down", ["hip_flexor_mobility"]],
    ]);
    expect(doses(r.finalPrescription)).toEqual(doses(keep.finalPrescription).slice(0, 1));
    // Warm-up unchanged; rests unchanged (never a shorter rest to make a session fit).
    expect(r.finalPrescription.structure.blocks[0]!.items.map((i) => (i.kind === "exercise" ? [i.sets, i.restSeconds] : null))).toEqual(
      keep.finalPrescription.structure.blocks[0]!.items.map((i) => (i.kind === "exercise" ? [i.sets, i.restSeconds] : null))
    );
    const planned = new Map(s.plannedPrescription.structure.blocks.flatMap((b) => b.items.map((i) => [`${b.role}:${i.kind === "exercise" ? i.exerciseId : i.drillId}`, i.prescriptionItemId] as const)));
    for (const b of r.finalPrescription.structure.blocks.filter((x) => x.role !== "cool_down")) for (const i of b.items) expect(i.derivedFromItemId).toBe(planned.get(`${b.role}:${i.kind === "exercise" ? i.exerciseId : i.drillId}`));
    expect([r.effectiveDurationMin, r.timeConstraint?.after]).toEqual([29, { decision: "MODIFY", kind: s.kind, loadProfile: "MODERATE", durationMin: 29 }]);
    valid(r.finalPrescription);
  });

  it("a LIGHT Force (estimated 40 min): 40 fits as is; 35 → cool-down reduced (33); 25 → the principal alone (24); 20 → no Force pretends to fit (recovery)", () => {
    const s = find(INTRO, "STRENGTH_LOWER", 45);
    const at = (limit: number) => created(buildFinalPrescriptionWithinTodayTimeV2(input(s, INTRO, limit)));
    expect([at(40).finalPrescription.reconciliationAction, at(40).effectiveDurationMin]).toEqual(["keep", 40]);
    expect([at(35).effectiveDurationMin, roles(at(35).finalPrescription).length]).toEqual([33, 5]);
    expect([at(25).effectiveDurationMin, roles(at(25).finalPrescription).map(([role]) => role)]).toEqual([24, ["warm_up", "main", "cool_down"]]);
    expect(at(20).finalPrescription.structure.family).toBe("recovery");
  });

  it("an overload-week Force (MODERATE_PLUS) whose principal alone does not fit 30 min: recovery, never fewer sets", () => {
    const s = BUILD.weeks[1]!.sessions.find((x) => x.kind === "STRENGTH_LOWER")!;
    expect((s.plannedPrescription.structure.blocks.find((b) => b.role === "main")!.items[0] as { sets: number }).sets).toBe(5);
    expect(created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30))).finalPrescription.structure.family).toBe("recovery");
  });
});

describe("A10 — endurance: the same protocol, shorter, never under 45", () => {
  it("E — endurance 60 + 45 min: MODIFY → the same protocol and activity choice at 45 min", () => {
    const s = find(BUILD, "AEROBIC_BASE", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 45)));
    expect(r.finalPrescription).toMatchObject({ reconciliationAction: "modify", structure: { protocolId: "endurance_base_continuous", activitySelection: s.plannedPrescription.structure.activitySelection } });
    expect(r.finalPrescription.structure.blocks.reduce((sum, b) => sum + b.durationMinutes!.max, 0)).toBe(45);
    expect(r.timeConstraint?.after).toMatchObject({ decision: "MODIFY", kind: "AEROBIC_BASE", durationMin: 45 });
    valid(r.finalPrescription);
  });

  it("endurance 45 + 30 min: below the protocol's 45 → recovery", () => {
    const s = find(BUILD, "AEROBIC_BASE", 45);
    expect(created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30))).finalPrescription.structure.family).toBe("recovery");
  });

  it("G — 30 min and no riding window: no bike activity anywhere (recovery has no activity choice)", () => {
    const s = find(BUILD, "AEROBIC_BASE", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30, { ridingAvailable: false })));
    expect(r.finalPrescription.structure.family).toBe("recovery");
    expect(r.finalPrescription.structure.activitySelection).toBeUndefined();
  });
});

describe("A10 — DH: the planner's windows only", () => {
  it("F — DH 90 + 75 min: the same drill in the 75-min window, passages capped at 6", () => {
    const s = find(BUILD, "DH_TECHNICAL", 90);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 75)));
    expect(drill(r.finalPrescription).drillId).toBe((s.plannedPrescription.structure.blocks.find((b) => b.role === "main")!.items[0] as DrillItemV2).drillId);
    expect(drill(r.finalPrescription).measure.count).toBeLessThanOrEqual(6);
    expect([r.finalPrescription.reconciliationAction, r.effectiveDurationMin]).toEqual(["modify", 75]);
    valid(r.finalPrescription);
  });

  it("F — DH 90 + 60 min: the 60-min window, at most 5 passages", () => {
    const s = find(BUILD, "DH_TECHNICAL", 90);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 60)));
    expect([r.effectiveDurationMin, drill(r.finalPrescription).measure.count <= 5]).toEqual([60, true]);
  });

  it("F — DH 90 + 30 min: no DH pretends to fit; recovery", () => {
    const s = find(BUILD, "DH_TECHNICAL", 90);
    expect(created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30))).finalPrescription.structure.family).toBe("recovery");
  });
});

describe("A10 — recovery and REST", () => {
  it("recovery narrowed to its protocol ranges: 25 min → main 20–20 + breathing, never more than 25", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 25)));
    expect(prescriptionMaxMinutes(r)).toBeLessThanOrEqual(25);
    expect(r.finalPrescription.structure.blocks.find((b) => b.role === "main")!.durationMinutes).toEqual({ min: 20, max: 20 });
  });

  it("H — very little time (15 min): REST, no invented session", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    expect(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 15))).toMatchObject({ status: "none", reason: "rest", timeConstraint: { action: "rest", after: { decision: "REST", kind: "REST" } } });
  });

  it("an M1 REST stays REST (fits)", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    expect(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30, { decision: "REST", finalSession: { kind: "REST" } }))).toMatchObject({ status: "none", timeConstraint: { action: "fits" } });
  });
});

describe("A10 — L: another rule's adaptation plus the time limit, never a load increase", () => {
  it("M1 MODIFY Force LIGHT (estimated 40) + 30 min → M1's LIGHT dose, shortened to two exercises (28), never back up", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30, { decision: "MODIFY", finalSession: { kind: s.kind, loadProfile: "LIGHT" } })));
    expect(r.finalPrescription).toMatchObject({ reconciliationAction: "modify", adaptationRuleIds: [DAILY_ADAPTATION_RULES_V2.strengthShortened, DAILY_ADAPTATION_RULES_V2.todayTimeLimit] });
    expect(r.timeConstraint?.after).toEqual({ decision: "MODIFY", kind: s.kind, loadProfile: "LIGHT", durationMin: 28 });
    expect((r.finalPrescription.structure.blocks.find((b) => b.role === "main")!.items[0] as { sets: number; rpeTarget: unknown }).rpeTarget).toEqual({ min: 5, max: 6 });
  });

  it("M1 REPLACE lower → upper MODERATE (estimated 47) + 45 min → REPLACE upper, still MODERATE, cool-down reduced (41)", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 45, { decision: "REPLACE", finalSession: { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" } })));
    expect(r.timeConstraint?.after).toEqual({ decision: "REPLACE", kind: "STRENGTH_UPPER", loadProfile: "MODERATE", durationMin: 41 });
  });

  it("M1 MODIFY DH LIGHT + 75 min: the 75-min window keeps the LIGHT passages (≤ 4), never back up", () => {
    const s = find(BUILD, "DH_TECHNICAL", 90);
    const m1 = input(s, BUILD, 75, { decision: "MODIFY", finalSession: { kind: s.kind, loadProfile: "LIGHT", durationMin: 90 } });
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(m1));
    expect([r.effectiveDurationMin, drill(r.finalPrescription).measure.count <= 4, r.timeConstraint?.after.loadProfile]).toEqual([75, true, "LIGHT"]);
  });

  it("an upward MODIFY stays blocked (P0, not this ticket): outcome « not_evaluated »", () => {
    const s = find(INTRO, "DH_TECHNICAL");
    const r = buildFinalPrescriptionWithinTodayTimeV2(input(s, INTRO, 30, { decision: "MODIFY", finalSession: { kind: s.kind, loadProfile: "MODERATE", durationMin: 90 } }));
    expect(r).toMatchObject({ status: "blocked", timeConstraint: { action: "not_evaluated" } });
  });

  it("every adapted prescription, every family, every limit 15–120: never more than the limit, always valid", () => {
    const sessions = BUILD.weeks.flatMap((w) => w.sessions).filter((x) => x.kind !== "REST");
    for (const s of sessions) {
      for (let limit = 15; limit <= 120; limit += 5) {
        const r = buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, limit));
        if (r.status === "created") {
          expect(prescriptionMaxMinutes(r)).not.toBeNull();
          expect(prescriptionMaxMinutes(r)!).toBeLessThanOrEqual(limit);
          valid(r.finalPrescription);
        } else expect(r).toMatchObject({ status: "none", reason: "rest" });
      }
    }
  });
});
