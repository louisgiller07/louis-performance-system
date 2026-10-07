import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  DAILY_ADAPTATION_RULES_V2,
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
  };
}

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

  it("B — 90 min for a 60-min Force: KEEP, verbatim, outcome « fits »", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 90)));
    expect(r.finalPrescription).toMatchObject({ reconciliationAction: "keep", adaptationRuleIds: [] });
    expect(r.timeConstraint).toMatchObject({ availableMinutes: 90, action: "fits", before: { decision: "KEEP", durationMin: 60 } });
  });

  it("exactly the session's duration fits (≤, not <)", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    expect(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 60)).timeConstraint?.action).toBe("fits");
  });
});

describe("A10 — Force: validated doses only", () => {
  it("C — Force 60 + 45 min: MODIFY → the real LIGHT dose (same template and exercises as A04's MODIFY LIGHT), 45 min", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 45)));
    const a04 = created(buildFinalPrescriptionV2(input(s, BUILD, null, { decision: "MODIFY", finalSession: { kind: s.kind, loadProfile: "LIGHT" } })));
    expect(r.finalPrescription.structure.blocks.map((b) => b.items.map((i) => (i.kind === "exercise" ? [i.exerciseId, i.sets] : null)))).toEqual(
      a04.finalPrescription.structure.blocks.map((b) => b.items.map((i) => (i.kind === "exercise" ? [i.exerciseId, i.sets] : null)))
    );
    expect(r.finalPrescription).toMatchObject({ reconciliationAction: "modify", adaptationRuleIds: [DAILY_ADAPTATION_RULES_V2.strengthLightDose, DAILY_ADAPTATION_RULES_V2.todayTimeLimit] });
    expect([r.effectiveDurationMin, r.timeConstraint?.action, r.timeConstraint?.after]).toEqual([45, "adapted", { decision: "MODIFY", kind: s.kind, loadProfile: "LIGHT", durationMin: 45 }]);
    valid(r.finalPrescription);
  });

  it("D — Force 60 + 30 min: no « 30-min Force »; active recovery inside 30 min (REPLACE)", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30)));
    expect(r.finalPrescription.structure).toMatchObject({ family: "recovery", sessionKind: "RECOVERY_ACTIVE" });
    expect(r.finalPrescription.reconciliationAction).toBe("replace");
    expect(prescriptionMaxMinutes(r)).toBeLessThanOrEqual(30);
    expect(r.timeConstraint?.after).toEqual({ decision: "REPLACE", kind: "RECOVERY_ACTIVE" });
    valid(r.finalPrescription);
  });

  it("a Force already LIGHT 45 with 40 min: no shorter Force, recovery", () => {
    const s = find(INTRO, "STRENGTH_LOWER", 45);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, INTRO, 40)));
    expect(r.finalPrescription.structure.family).toBe("recovery");
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
  it("M1 MODIFY Force LIGHT (45) + 30 min → recovery", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 30, { decision: "MODIFY", finalSession: { kind: s.kind, loadProfile: "LIGHT" } })));
    expect(r.finalPrescription.structure.family).toBe("recovery");
  });

  it("M1 REPLACE lower → upper MODERATE (60) + 45 min → REPLACE upper LIGHT 45", () => {
    const s = find(BUILD, "STRENGTH_LOWER", 60);
    const r = created(buildFinalPrescriptionWithinTodayTimeV2(input(s, BUILD, 45, { decision: "REPLACE", finalSession: { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" } })));
    expect(r.timeConstraint?.after).toEqual({ decision: "REPLACE", kind: "STRENGTH_UPPER", loadProfile: "LIGHT", durationMin: 45 });
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
