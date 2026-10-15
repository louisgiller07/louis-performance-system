import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  DAILY_ADAPTATION_RULES_V2,
  generatePlanV2InMemory,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type ExerciseItemV2,
  type DrillItemV2,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// A04 — MODIFY / REPLACE give a real, executable V2 final prescription
// (ADR UX-11A.5c.0 §3–§9 completed by ADR A04). Plans are generated in memory
// by the real V2 planner; doses come from the PROVISIONAL V2 content.

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
  // A rider already training: the block starts at build (MODERATE doses, the ones MODIFY lowers).
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};

function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}

const PLAN: PlanV2InMemory = (() => {
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" }, snapshot: SNAPSHOT, mintId: counter("a") });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  return r.plan;
})();

const session = (kind: string): PlanSessionV2InMemory => {
  const s = PLAN.weeks[0]!.sessions.find((x) => x.kind === kind);
  if (!s) throw new Error(`no ${kind} session`);
  return s;
};

// No recent history: week 1 is an introduction week, every session at the LIGHT load.
const LIGHT_PLAN: PlanV2InMemory = (() => {
  const r = generatePlanV2InMemory({
    block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" },
    snapshot: { ...SNAPSHOT, recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 } },
    mintId: counter("c"),
  });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  return r.plan;
})();

function input(
  s: PlanSessionV2InMemory,
  decision: "KEEP" | "MODIFY" | "REPLACE" | "REST",
  finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"],
  ridingAvailable = true,
  plan: PlanV2InMemory = PLAN
): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: plan.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: plan.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable, mintId: counter("b") },
  };
}

function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}

const items = (p: PrescriptionV2) => p.blocks.flatMap((b) => b.items);
const work = (p: PrescriptionV2) => p.blocks.filter((b) => b.role === "main" || b.role === "complementary").flatMap((b) => b.items) as ExerciseItemV2[];
const drill = (p: PrescriptionV2) => p.blocks.find((b) => b.role === "main")!.items[0] as DrillItemV2;
const minutes = (p: PrescriptionV2) => p.blocks.reduce((sum, b) => sum + (b.durationMinutes?.min ?? 0), 0);

/** Executable: valid final V2 document whose every item carries what the guided session needs. */
function assertExecutable(f: FinalPrescriptionV2) {
  expect(validatePrescriptionV2(f.structure, { stage: "final" })).toMatchObject({ ok: true });
  expect(f.catalogVersion).toBe(f.structure.catalog.aggregate);
  for (const item of items(f.structure)) {
    expect(item.prescriptionItemId).toMatch(/^00000000-0000-4000-8000-b/);
    if (item.kind === "exercise") {
      expect(item.sets).toBeGreaterThan(0);
      expect(item.measure).toBeDefined();
      expect(item.cueId).toBeTruthy();
    } else {
      expect(item.measure.count).toBeGreaterThanOrEqual(4);
    }
  }
}

describe("A04 — KEEP and REST are unchanged", () => {
  it("A — KEEP: verbatim copy (same ids), no adaptation rule", () => {
    const s = session("STRENGTH_LOWER");
    const f = created(buildFinalPrescriptionV2(input(s, "KEEP", { kind: s.kind, loadProfile: s.loadProfile!, durationMin: s.durationMin })));
    expect(f).toMatchObject({ reconciliationAction: "keep", adaptationRuleIds: [], plannedPrescriptionId: s.plannedPrescription.id });
    expect(f.structure).toEqual(s.plannedPrescription.structure);
  });

  it("B — REST: no document", () => {
    expect(buildFinalPrescriptionV2(input(session("DH_TECHNICAL"), "REST", { kind: "REST" }))).toEqual({ status: "none", reason: "rest" });
  });
});

describe("A04 — MODIFY: same session, lower dose, real content", () => {
  it("D — Force MODERATE → LIGHT: same template and exercises, LIGHT sets / reps / RPE / rest; ids new with derivedFromItemId", () => {
    const s = session("STRENGTH_LOWER");
    const planned = s.plannedPrescription.structure;
    const f = created(buildFinalPrescriptionV2(input(s, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" })));
    assertExecutable(f);
    expect(f).toMatchObject({ reconciliationAction: "modify", activeSessionOrigin: "generated", plannedPrescriptionId: s.plannedPrescription.id, adaptationRuleIds: [DAILY_ADAPTATION_RULES_V2.strengthLightDose] });
    expect(f.structure.templateId).toBe(planned.templateId);
    expect(items(f.structure).map((i) => (i as ExerciseItemV2).exerciseId)).toEqual(items(planned).map((i) => (i as ExerciseItemV2).exerciseId));
    expect(items(f.structure).map((i) => i.derivedFromItemId)).toEqual(items(planned).map((i) => i.prescriptionItemId));
    expect(items(f.structure).some((i) => items(planned).some((p) => p.prescriptionItemId === i.prescriptionItemId))).toBe(false);
    const principal = work(f.structure).find((i) => i.role === "principal")!;
    expect([principal.sets, principal.measure, principal.rpeTarget, principal.restSeconds]).toEqual([3, { type: "reps", min: 8, max: 10, perSide: false }, { min: 5, max: 6 }, { min: 90, max: 120 }]);
    expect(work(f.structure).every((i) => i.rpeTarget!.max <= 6)).toBe(true);
    expect(work(planned).find((i) => i.role === "principal")!.sets).toBe(4);
  });

  it("C — DH MODERATE → LIGHT: the SAME drill, cue and success criterion, fewer passages (6 → 4)", () => {
    const s = session("DH_TECHNICAL");
    const planned = s.plannedPrescription.structure;
    const f = created(buildFinalPrescriptionV2(input(s, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: s.durationMin })));
    assertExecutable(f);
    expect(f.adaptationRuleIds).toEqual([DAILY_ADAPTATION_RULES_V2.dhLightPasses]);
    expect(drill(planned).measure.count).toBe(6);
    expect(drill(f.structure)).toMatchObject({ drillId: drill(planned).drillId, cueId: drill(planned).cueId, successCriterionId: drill(planned).successCriterionId, measure: { type: "pass", count: 4 }, derivedFromItemId: drill(planned).prescriptionItemId });
    expect(f.structure.intentId).toBe(planned.intentId);
    expect(f.structure.blocks.map((b) => b.instructionIds)).toEqual(planned.blocks.map((b) => b.instructionIds));
  });

  it("endurance MODERATE → LIGHT: same protocol and activities, 45 min", () => {
    const s = session("AEROBIC_BASE");
    const f = created(buildFinalPrescriptionV2(input(s, "MODIFY", { kind: "AEROBIC_BASE", loadProfile: "LIGHT" })));
    assertExecutable(f);
    expect(f.structure.protocolId).toBe(s.plannedPrescription.structure.protocolId);
    expect(f.structure.activitySelection).toEqual(s.plannedPrescription.structure.activitySelection);
    expect(minutes(f.structure)).toBe(45);
  });

  it.each([
    ["STRENGTH_LOWER", "MODERATE"],
    ["STRENGTH_LOWER", "HEAVY"],
    ["DH_TECHNICAL", "MODERATE"],
    ["AEROBIC_BASE", "HEAVY"],
  ] as const)("§6 — planned LIGHT %s + requested %s → blocked upward_modify_not_supported (never the planned dose relabelled MODIFY)", (kind, requested) => {
    const s = LIGHT_PLAN.weeks[0]!.sessions.find((x) => x.kind === kind)!;
    expect(s.loadProfile).toBe("LIGHT");
    expect(buildFinalPrescriptionV2(input(s, "MODIFY", { kind, loadProfile: requested }, true, LIGHT_PLAN))).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "upward_modify_not_supported", planned: "LIGHT", final: requested },
    });
  });

  it("a MODIFY that does not change the planned load is not a document either (modify_not_supported)", () => {
    const s = session("STRENGTH_UPPER");
    expect(buildFinalPrescriptionV2(input(s, "MODIFY", { kind: s.kind, loadProfile: "MODERATE" }))).toMatchObject({ status: "blocked", detail: { reason: "modify_not_supported" } });
  });

  it("an older planned aggregate is a catalogue mismatch (never adapted with the current tables)", () => {
    const s = session("STRENGTH_LOWER");
    const i = input(s, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" });
    const old = JSON.parse(JSON.stringify(i.plannedPrescription!.structure));
    old.catalog = { ...old.catalog, aggregate: "session-model-v2.5", strengthDoses: "strength-doses-v2.1", planDosePolicy: "plan-dose-policy-v2.3" };
    const r = buildFinalPrescriptionV2({ ...i, plannedPrescription: { ...i.plannedPrescription!, catalogVersion: "session-model-v2.5", structure: old } });
    expect(r).toEqual({ status: "blocked", code: "final_prescription_catalog_mismatch", detail: { plannedAggregate: "session-model-v2.5", runtimeAggregate: "session-model-v2.6" } });
  });
});

describe("A04 — REPLACE: a really prescribed session of the new kind", () => {
  it("E — DH → Force LIGHT: a complete Force session (exercises, sets, reps, RPE, rest), no lineage of items", () => {
    const s = session("DH_TECHNICAL");
    const f = created(buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "STRENGTH_LOWER", loadProfile: "LIGHT" })));
    assertExecutable(f);
    expect(f).toMatchObject({ reconciliationAction: "replace", activeSessionOrigin: "generated", adaptationRuleIds: [DAILY_ADAPTATION_RULES_V2.replaceStrength] });
    expect(f.plannedPrescriptionId).toBeUndefined();
    expect(f.structure).toMatchObject({ family: "strength", sessionKind: "STRENGTH_LOWER", templateId: "strength_lower_intermediate_v1" });
    expect(work(f.structure).length).toBeGreaterThanOrEqual(3);
    for (const i of work(f.structure)) {
      expect(i.sets).toBeGreaterThan(0);
      expect(i.rpeTarget).toBeDefined();
      expect(i.restSeconds).toBeDefined();
    }
    expect(items(f.structure).every((i) => i.derivedFromItemId === undefined)).toBe(true);
  });

  it("Force lower → upper MODERATE (legs RED, M1 C3.6): the upper template for the plan's tier and equipment", () => {
    const s = session("STRENGTH_LOWER");
    const f = created(buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" })));
    assertExecutable(f);
    expect(f.structure).toMatchObject({ sessionKind: "STRENGTH_UPPER", templateId: "strength_upper_intermediate_v1" });
    expect(work(f.structure).find((i) => i.role === "principal")!.sets).toBe(4);
  });

  it("DH technical → DH light (grip / legs RED, no_dh_intense): the same drill, 4 passages", () => {
    const s = session("DH_TECHNICAL");
    const f = created(buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "DH_LIGHT", loadProfile: "LIGHT", durationMin: 90 })));
    assertExecutable(f);
    expect(f.structure).toMatchObject({ family: "dh_technical", sessionKind: "DH_LIGHT", intentId: s.plannedPrescription.structure.intentId });
    expect(drill(f.structure)).toMatchObject({ drillId: drill(s.plannedPrescription.structure).drillId, measure: { count: 4 } });
    expect(drill(f.structure).derivedFromItemId).toBeUndefined();
  });

  it("F — any → endurance: 45–90 min, activities by the day's riding availability (BUG-V2-1)", () => {
    const s = session("STRENGTH_UPPER");
    const riding = created(buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 30 }, true)));
    assertExecutable(riding);
    expect(minutes(riding.structure)).toBe(45);
    expect(riding.structure.activitySelection!.activityIds).toContain("road_bike");
    const offTerrain = created(buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 60 }, false)));
    expect(minutes(offTerrain.structure)).toBe(60);
    expect(offTerrain.structure.activitySelection!.activityIds).toEqual(["home_trainer", "running"]);
  });

  it("Force → active recovery: the recovery protocol (very easy activity with its range and RPE, mobility, breathing)", () => {
    const s = session("STRENGTH_LOWER");
    const f = created(buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "RECOVERY_ACTIVE" })));
    assertExecutable(f);
    expect(f.structure).toMatchObject({ family: "recovery", sessionKind: "RECOVERY_ACTIVE", protocolId: "recovery_active_v1", intentId: "recovery_without_fatigue" });
    expect(f.structure.blocks[0]).toMatchObject({ role: "main", durationMinutes: { min: 20, max: 40 }, rpeTarget: { min: 2, max: 3 } });
    expect(items(f.structure).map((i) => (i as ExerciseItemV2).exerciseId)).toEqual(["cat_cow", "hip_90_90", "thoracic_rotation_mobility", "breathing_long_exhale"]);
  });

  it("a target the V2 builders cannot produce keeps an explicit, non-normal block", () => {
    expect(buildFinalPrescriptionV2(input(session("DH_TECHNICAL"), "REPLACE", { kind: "RACE_ACTIVITY" }))).toMatchObject({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "replace_target_not_supported", target: "RACE_ACTIVITY" },
    });
  });
});

describe("A04 — lineage and determinism", () => {
  it("H — MODIFY / REPLACE without real plan lineage (no planned session, another version) → no_lineage, never an invented session", () => {
    const s = session("STRENGTH_LOWER");
    expect(buildFinalPrescriptionV2({ ...input(s, "REPLACE", { kind: "RECOVERY_ACTIVE" }), lineage: null })).toEqual({ status: "blocked", code: "final_prescription_no_lineage", detail: { reason: "no_planned_session" } });
    const other = input(s, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" });
    expect(buildFinalPrescriptionV2({ ...other, lineage: { ...other.lineage!, currentPlanVersionId: "another-version" } })).toMatchObject({ status: "blocked", code: "final_prescription_no_lineage", detail: { reason: "not_current_plan_version" } });
  });

  it("same inputs and ids → the same document", () => {
    const s = session("DH_TECHNICAL");
    const a = buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" }));
    const b = buildFinalPrescriptionV2(input(s, "REPLACE", { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" }));
    expect(a).toEqual(b);
  });
});
