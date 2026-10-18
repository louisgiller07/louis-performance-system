import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  canonicalSportContent,
  DAILY_ADAPTATION_RULES_V2,
  generatePlanV2InMemory,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// SPORT-SAFE-01 (HPM 2026-10-18) — ADR A04 §6 applied to the day's outcome: the policy's LIGHT endurance duration
// (45 min) is the only endurance lever (the protocol's RPE is fixed), so M1's LIGHT on a session already planned at
// 45 min has no lighter content. The daily entry point (buildFinalPrescriptionWithinTodayTimeV2, the only production
// caller) refuses it (`modify_not_supported`), never a "modified" copy of the planned dose announced to the rider as
// lighter. A longer session is still really shortened to 45 min, and the rider's time (A10) still adapts the session.

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  // Already training: build (endurance MODERATE 45), then build_plus (endurance MODERATE 60).
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};
const counter = (prefix: string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
};
const PLAN: PlanV2InMemory = (() => {
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-25" }, snapshot: SNAPSHOT, mintId: counter("a") });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  return r.plan;
})();
const session = (week: number, kind: PlanSessionV2InMemory["kind"]) => {
  const s = PLAN.weeks[week]!.sessions.find((x) => x.kind === kind);
  if (!s) throw new Error(`no ${kind} session in week ${week + 1}`);
  return s;
};
const endurance = (week: number) => session(week, "AEROBIC_BASE");
function input(s: PlanSessionV2InMemory, decision: "KEEP" | "MODIFY", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: PLAN.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: PLAN.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable: true, mintId: counter("b") },
  };
}
const today = (i: BuildFinalPrescriptionV2Input, availableMinutes: number | null) => buildFinalPrescriptionWithinTodayTimeV2({ ...i, availableMinutes });
function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}
const minutes = (p: PrescriptionV2) => p.blocks.reduce((sum, b) => sum + (b.durationMinutes?.min ?? 0), 0);
const main = (p: PrescriptionV2) => p.blocks.find((b) => b.role === "main")!;
const REFUSED = { status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "modify_not_supported", planned: "MODERATE", final: "LIGHT", durationMin: 45 } } as const;

describe("SPORT-SAFE-01 — endurance LIGHT: a real reduction, or an explicit refusal", () => {
  it("the plan: build endurance MODERATE 45, build_plus endurance MODERATE 60 (fixed protocol RPE 3–4)", () => {
    expect([endurance(0).loadProfile, endurance(0).durationMin, endurance(1).loadProfile, endurance(1).durationMin]).toEqual(["MODERATE", 45, "MODERATE", 60]);
    expect(main(endurance(0).plannedPrescription.structure)).toMatchObject({ durationMinutes: { min: 30, max: 30 }, rpeTarget: { min: 3, max: 4 } });
  });

  it("the anomaly (builder alone): M1's LIGHT on the 45-min session rebuilds exactly the planned sport content", () => {
    const s = endurance(0);
    const f = created(buildFinalPrescriptionV2(input(s, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT" })));
    expect(f.adaptationRuleIds).toEqual([DAILY_ADAPTATION_RULES_V2.enduranceLightDuration]);
    expect(canonicalSportContent(f.structure)).toBe(canonicalSportContent(s.plannedPrescription.structure));
  });

  it.each([
    ["no duration from M1, no time given", { kind: "AEROBIC_BASE", loadProfile: "LIGHT" }, null],
    ["M1's 45 min, no time given", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 }, null],
  ] as const)("planned MODERATE 45 + MODIFY LIGHT (%s) → refused modify_not_supported, never the planned dose relabelled", (_, finalSession, availableMinutes) => {
    expect(today(input(endurance(0), "MODIFY", finalSession), availableMinutes)).toEqual(REFUSED);
  });

  it.each([45, 60, 90])("planned MODERATE 45 + MODIFY LIGHT, %i min available (it fits) → refused, time not evaluated", (availableMinutes) => {
    const r = today(input(endurance(0), "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 }), availableMinutes);
    expect(r).toEqual({
      ...REFUSED,
      timeConstraint: { availableMinutes, action: "not_evaluated", before: { decision: "MODIFY", kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 }, after: { decision: "MODIFY", kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 } },
    });
  });

  it("planned MODERATE 45 + MODIFY LIGHT, 30 min available → A10 still adapts: a real, shorter session within 30 min", () => {
    const s = endurance(0);
    const r = today(input(s, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 }), 30);
    expect(r.timeConstraint?.action).toBe("adapted");
    const f = created(r);
    expect(minutes(f.structure)).toBeLessThanOrEqual(30);
    expect(canonicalSportContent(f.structure)).not.toBe(canonicalSportContent(s.plannedPrescription.structure));
  });

  it.each([null, 60])("planned MODERATE 60 + MODIFY LIGHT (time %s) → created and really lighter: 45 min (main 30 instead of 45), same protocol and activities", (availableMinutes) => {
    const s = endurance(1);
    const planned = s.plannedPrescription.structure;
    const r = today(input(s, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT" }), availableMinutes);
    const f = created(r);
    expect(validatePrescriptionV2(f.structure, { stage: "final" })).toMatchObject({ ok: true });
    expect(f.adaptationRuleIds).toEqual([DAILY_ADAPTATION_RULES_V2.enduranceLightDuration]);
    expect([minutes(planned), minutes(f.structure)]).toEqual([60, 45]);
    expect([main(planned).durationMinutes, main(f.structure).durationMinutes]).toEqual([{ min: 45, max: 45 }, { min: 30, max: 30 }]);
    expect(f.structure.protocolId).toBe(planned.protocolId);
    expect(f.structure.activitySelection).toEqual(planned.activitySelection);
    expect(r.timeConstraint?.action).toBe(availableMinutes === null ? undefined : "fits");
  });

  it("unchanged: KEEP of the 45-min session is the verbatim planned document", () => {
    const s = endurance(0);
    const f = created(today(input(s, "KEEP", { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 45 }), null));
    expect(f.structure).toEqual(s.plannedPrescription.structure);
  });

  it("unchanged: DH MODIFY LIGHT stays the policy's real reduction (fewer passes), not refused", () => {
    const s = PLAN.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "DH_TECHNICAL" && x.loadProfile === "MODERATE");
    if (!s) throw new Error("no DH MODERATE session in the plan");
    const passes = (p: PrescriptionV2) => main(p).items!.reduce((sum, i) => sum + (i.measure.type === "pass" ? i.measure.count : 0), 0);
    const f = created(today(input(s, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: s.durationMin }), null));
    expect(f.adaptationRuleIds).toEqual([DAILY_ADAPTATION_RULES_V2.dhLightPasses]);
    expect([passes(s.plannedPrescription.structure), passes(f.structure)]).toEqual([6, 4]);
  });

  it("unchanged: A10 with 30 min on the 45-min session → active recovery within 30 min (the rider's time, a real change)", () => {
    const r = today(input(endurance(0), "KEEP", { kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 45 }), 30);
    expect(r.timeConstraint?.after).toMatchObject({ decision: "REPLACE", kind: "RECOVERY_ACTIVE" });
    expect(minutes(created(r).structure)).toBeLessThanOrEqual(30);
  });
});
