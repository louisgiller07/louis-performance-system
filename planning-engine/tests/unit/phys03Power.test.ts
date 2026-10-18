import { describe, expect, it } from "vitest";
import {
  assignPrescriptionIds,
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  buildPowerPrescriptionV2Content,
  buildSessionModelV2CatalogManifest,
  dailyAdaptationContextV2,
  estimateStrengthDurationMinutesV2,
  generatePlanV2InMemory,
  isPowerSessionPossibleV2,
  placePowerSessionsV2,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type ExerciseItemV2Content,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlannedWeekV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2Content,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with their switches ON (every switch off: the production behaviour,
// proven by the production tests kept unchanged and by phys00FlagsOffEquivalence).
const PHYS_ON = { daily: true, intervals: true, power: true, mobility: true } as const;

// PHYS-03 — the power (explosiveness) session: existing catalogue content composed in the v2.6 format
// (docs/03 §5 envelope), placed in build weeks with the server option only, one dose per day.

const catalog = buildSessionModelV2CatalogManifest();
const power = (athleteTier: "beginner" | "intermediate" | "advanced", equipment: string[], workSlots?: number) =>
  buildPowerPrescriptionV2Content({ athleteTier, equipment, catalog, ...(workSlots !== undefined ? { workSlots } : {}) });
const items = (c: PrescriptionV2Content, role: string) => c.blocks.filter((b) => b.role === role).flatMap((b) => b.items as readonly ExerciseItemV2Content[]);
const ids = (c: PrescriptionV2Content, role: string) => items(c, role).map((i) => i.exerciseId);

describe("PHYS-03 — the power session (catalogue content, v2.6 format)", () => {
  it("intermediate with dumbbells: progressive warm-up, 4 explosive exercises in order, cool-down; existing fields only", () => {
    const c = power("intermediate", ["dumbbells", "bench"]);
    expect(c).toMatchObject({ family: "power", sessionKind: "POWER", intentId: "corner_exit_power" });
    expect(c.blocks.map((b) => b.role)).toEqual(["warm_up", "main", "main", "main", "main", "cool_down"]);
    expect(ids(c, "warm_up")).toEqual(["hip_90_90", "knee_to_wall_ankle", "bird_dog", "pogo_hops"]);
    expect(items(c, "warm_up").map((i) => i.role)).toEqual(["warm_up", "warm_up", "activation", "activation"]);
    expect(c.blocks[0]!.instructionIds).toEqual(["instruction.strength_warm_up.mobility", "instruction.strength_warm_up.activation"]);
    expect(ids(c, "main")).toEqual(["squat_jump", "broad_jump", "skater_jump", "dumbbell_swing"]);
    expect(ids(c, "cool_down")).toEqual(["hip_flexor_mobility", "breathing_long_exhale"]);
    expect(c.blocks.at(-1)!.instructionIds).toEqual(["instruction.recovery.light_mobility"]);
    // docs/03 §5: 3–5 sets of 3–5 reps, full rest 2–3 min, stop as soon as quality drops; no RPE, no load, no height.
    for (const item of items(c, "main")) {
      expect([item.role, item.sets, item.restSeconds]).toEqual(["explosive", 3, { min: 120, max: 180 }]);
      expect(item.measure.type).toBe("reps");
      expect(item.vigilanceIds).toContain("vigilance.power_stop_on_quality_loss");
      expect(item.rpeTarget).toBeUndefined();
    }
    expect(items(c, "main").map((i) => (i.measure.type === "reps" ? [i.measure.min, i.measure.max, i.measure.perSide] : null))).toEqual([[3, 5, false], [3, 3, false], [3, 5, true], [5, 5, false]]);
    expect(JSON.stringify(c)).not.toMatch(/kg|load|height|hauteur|percent|1rm|templateId|protocolId|rampUp/i);
    expect(validatePrescriptionV2(assignPrescriptionIds(c, counter("p"))).ok).toBe(true);
    expect(estimateStrengthDurationMinutesV2(c)).toBe(59);
  });

  it("limited equipment (none): the 3 jumps; an advanced rider without equipment adds the plyometric push-up", () => {
    expect(ids(power("intermediate", []), "main")).toEqual(["squat_jump", "broad_jump", "skater_jump"]);
    expect(estimateStrengthDurationMinutesV2(power("intermediate", []))).toBe(51);
    expect(ids(power("advanced", []), "main")).toEqual(["squat_jump", "broad_jump", "skater_jump", "plyo_pushup"]);
    expect(ids(power("advanced", ["dumbbells"]), "main")).toEqual(["squat_jump", "broad_jump", "skater_jump", "dumbbell_swing"]);
  });

  it("a beginner has no explosive exercise at their tier (catalogue): no power session, never an invented one", () => {
    expect(isPowerSessionPossibleV2("beginner", ["dumbbells", "bench", "barbell"])).toBe(false);
    expect(isPowerSessionPossibleV2("intermediate", [])).toBe(true);
    expect(() => power("beginner", ["dumbbells"])).toThrow(/needs 3 explosive exercises, 0 allowed for beginner/);
  });

  it("work slots (A10): the first explosive exercises kept, never below three", () => {
    expect(ids(power("intermediate", ["dumbbells"], 3), "main")).toEqual(["squat_jump", "broad_jump", "skater_jump"]);
    expect(() => power("intermediate", ["dumbbells"], 2)).toThrow(/power workSlots must be 3 to 4/);
  });
});

// --- Plan ------------------------------------------------------------------------------------

const allDay: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: allDay, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["flow_trail", "bermed_trail"],
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
function plan(snapshot: PlanInputSnapshotV2, powerSessions?: boolean): PlanV2InMemory {
  const r = generatePlanV2InMemory({ block: BLOCK, snapshot, mintId: counter("a"), ...(powerSessions !== undefined ? { powerSessions } : {}) });
  if (r.status !== "generated") throw new Error(r.status);
  return r.plan;
}
const OFF = plan(SNAPSHOT);
const ON = plan(SNAPSHOT, true);
const strengthByWeek = (p: PlanV2InMemory) => p.weeks.map((w) => w.sessions.filter((s) => s.kind.startsWith("STRENGTH") || s.kind === "POWER").map((s) => [s.date, s.kind, s.durationMin, s.loadProfile]));

describe("PHYS-03 — plan placement (server option only)", () => {
  it("without the option: no power session, no new key — the previous plan", () => {
    expect(JSON.stringify(OFF)).not.toMatch(/"POWER"|power_session|powerPolicy/);
    expect(plan(SNAPSHOT, false)).toEqual(OFF);
  });

  it("with the option: each build week's lower-body Force slot is the power session (same date, duration, load); every other session unchanged", () => {
    expect(ON.weeks.map((w) => w.doseSummary.progression!.role)).toEqual(["introduction", "build", "build_plus", "consolidation", "build", "build_plus"]);
    expect(strengthByWeek(ON)).toEqual([
      [["2026-10-07", "STRENGTH_LOWER", 45, "LIGHT"], ["2026-10-08", "STRENGTH_UPPER", 45, "LIGHT"]],
      [["2026-10-14", "POWER", 60, "MODERATE"], ["2026-10-15", "STRENGTH_UPPER", 60, "MODERATE"]],
      [["2026-10-21", "STRENGTH_LOWER", 60, "MODERATE"], ["2026-10-22", "STRENGTH_UPPER", 60, "MODERATE"]],
      [["2026-10-27", "STRENGTH_LOWER", 45, "LIGHT"]],
      [["2026-11-04", "POWER", 60, "MODERATE"], ["2026-11-05", "STRENGTH_UPPER", 60, "MODERATE"]],
      [["2026-11-11", "STRENGTH_LOWER", 60, "MODERATE"], ["2026-11-12", "STRENGTH_UPPER", 60, "MODERATE"]],
    ]);
    const others = (p: PlanV2InMemory) => p.weeks.flatMap((w) => w.sessions.filter((s) => s.date !== "2026-10-14" && s.date !== "2026-11-04").map((s) => s.sportFingerprint));
    expect(others(ON)).toEqual(others(OFF));
    const week = ON.weeks[1]!;
    expect([week.doseSummary.progression!.reasonCodes.at(-1), week.doseSummary.progression!.powerPolicy]).toEqual(["power_session", "power-plan-v1+power-session-v1"]);
    expect(week.rationale).toContain("This week's lower-body strength session is a power session.");
    const s = week.sessions.find((x) => x.kind === "POWER")!;
    expect(s.plannedPrescription.structure.family).toBe("power");
    expect(validatePrescriptionV2(s.plannedPrescription.structure).ok).toBe(true);
  });

  it("a beginner (no explosive exercise at the tier): no power session even with the option", () => {
    expect(JSON.stringify(plan({ ...SNAPSHOT, strengthExperienceTier: "beginner" }, true))).not.toMatch(/"POWER"|power_session/);
  });

  it("never the day after a development session (docs/03 §5): M1's development kinds at MODERATE / HEAVY hold it; DH technique or a LIGHT session does not", () => {
    const week = (previous: { kind: string; loadProfile?: string }): PlannedWeekV2[] =>
      [
        {
          weekNumber: 1,
          startDate: "2026-10-12",
          endDate: "2026-10-18",
          weekType: "development",
          rationale: "Build week.",
          doseSummary: { progression: { role: "build", reasonCodes: ["cycle_progression"] } },
          sessions: [
            { date: "2026-10-13", kind: previous.kind, ...(previous.loadProfile ? { loadProfile: previous.loadProfile } : {}), rationale: "r" },
            { date: "2026-10-14", kind: "STRENGTH_LOWER", loadProfile: "MODERATE", rationale: "r" },
          ],
          relaxedConstraints: [],
        },
      ] as unknown as PlannedWeekV2[];
    const kindOn14 = (w: PlannedWeekV2[]) => placePowerSessionsV2(w, "intermediate", [])[0]!.sessions.find((s) => s.date === "2026-10-14")!.kind;
    expect(kindOn14(week({ kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }))).toBe("STRENGTH_LOWER");
    expect(kindOn14(week({ kind: "AEROBIC_INTERVALS", loadProfile: "MODERATE" }))).toBe("STRENGTH_LOWER");
    expect(kindOn14(week({ kind: "DH_TECHNICAL", loadProfile: "MODERATE" }))).toBe("POWER");
    expect(kindOn14(week({ kind: "STRENGTH_UPPER", loadProfile: "LIGHT" }))).toBe("POWER");
  });
});

// --- Daily -----------------------------------------------------------------------------------

const POWER_SESSION = ON.weeks[1]!.sessions.find((s) => s.kind === "POWER")!;
const UPPER = ON.weeks[1]!.sessions.find((s) => s.kind === "STRENGTH_UPPER")!;
function input(s: PlanSessionV2InMemory, decision: "KEEP" | "MODIFY" | "REPLACE", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]): BuildFinalPrescriptionV2Input {
  return {
    phys: PHYS_ON,
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: ON.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: ON.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(SNAPSHOT), ridingAvailable: true, mintId: counter("b") },
  };
}
const KEEP_POWER = { kind: "POWER", loadProfile: "MODERATE" as const, durationMin: 60 };
function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 & { effectiveDurationMin?: number } {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return { ...r.finalPrescription, ...(r.effectiveDurationMin !== undefined ? { effectiveDurationMin: r.effectiveDurationMin } : {}) };
}
const mainIds = (f: FinalPrescriptionV2) => f.structure.blocks.filter((b) => b.role === "main").map((b) => (b.items[0] as ExerciseItemV2Content).exerciseId);

describe("PHYS-03 — daily: one dose, the rider's time, M1's fatigue", () => {
  it("KEEP: the planned power session verbatim, its realistic duration (content estimate, 59 min)", () => {
    const f = created(buildFinalPrescriptionV2(input(POWER_SESSION, "KEEP", KEEP_POWER)));
    expect([f.reconciliationAction, f.adaptationRuleIds, f.effectiveDurationMin]).toEqual(["keep", [], 59]);
    expect(f.structure.blocks).toEqual(POWER_SESSION.plannedPrescription.structure.blocks);
  });

  it("M1 lowers the load (sleep, stress, pain → LIGHT): no lighter power session exists — decision kept, reason traced", () => {
    expect(buildFinalPrescriptionV2(input(POWER_SESSION, "MODIFY", { kind: "POWER", loadProfile: "LIGHT" }))).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "power_load_not_supported", planned: "MODERATE", final: "LIGHT" },
    });
  });

  it("M1 flags legs / grip fatigue without adapting the power session: no power document (docs/03 §5)", () => {
    expect(buildFinalPrescriptionV2({ ...input(POWER_SESSION, "KEEP", KEEP_POWER), powerFatigue: { cleared: false, rules: ["C3.6"] } })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "power_fatigue_not_cleared", rules: ["C3.6"] },
    });
    expect(created(buildFinalPrescriptionV2({ ...input(POWER_SESSION, "KEEP", KEEP_POWER), powerFatigue: { cleared: true } })).structure.family).toBe("power");
    // Not a power session: the gate never applies.
    expect(created(buildFinalPrescriptionV2({ ...input(UPPER, "KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE", durationMin: 60 }), powerFatigue: { cleared: false, rules: ["C3.5"] } })).structure.family).toBe("strength");
  });

  it("A10 — 60 min: fits; 55 min: the same session without its last explosive exercise (51 min); 50 min: active recovery (never below three)", () => {
    const r60 = buildFinalPrescriptionWithinTodayTimeV2({ ...input(POWER_SESSION, "KEEP", KEEP_POWER), availableMinutes: 60 });
    expect(r60.timeConstraint?.action).toBe("fits");
    const r55 = buildFinalPrescriptionWithinTodayTimeV2({ ...input(POWER_SESSION, "KEEP", KEEP_POWER), availableMinutes: 55 });
    const f55 = created(r55);
    expect([f55.reconciliationAction, f55.adaptationRuleIds, mainIds(f55), f55.effectiveDurationMin]).toEqual(["modify", ["v2.time.power_shortened", "v2.time.today_limit"], ["squat_jump", "broad_jump", "skater_jump"], 51]);
    expect(f55.structure.blocks.filter((b) => b.role === "main").every((b) => (b.items[0] as ExerciseItemV2Content).restSeconds!.min === 120)).toBe(true);
    expect(f55.structure.blocks.filter((b) => b.role !== "main").map((b) => b.role)).toEqual(["warm_up", "cool_down"]);
    const r50 = buildFinalPrescriptionWithinTodayTimeV2({ ...input(POWER_SESSION, "KEEP", KEEP_POWER), availableMinutes: 50 });
    expect(r50.timeConstraint).toMatchObject({ action: "adapted", after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } });
  });

  it("REST stays REST", () => {
    expect(buildFinalPrescriptionV2(input(POWER_SESSION, "REST" as "KEEP", { kind: "REST" })).status).toBe("none");
  });

  it("a manual power session: the catalogue session at MODERATE for the rider's tier; a beginner or another load is refused explicitly", () => {
    const manual = (loadProfile: "LIGHT" | "MODERATE", tier: "beginner" | "intermediate"): BuildFinalPrescriptionV2Input => ({
      finalPrescriptionId: "f",
      decision: { decisionId: "d", decision: "KEEP", finalSession: { kind: "POWER", loadProfile } },
      phys: PHYS_ON, lineage: { plannedSessionSource: "manual", sourcePlanVersionId: null, sourceGeneratedSessionId: null, currentPlanVersionId: ON.planVersionId, generatedSession: null, currentPlanCoversDate: true },
      plannedPrescription: null,
      adaptation: dailyAdaptationContextV2({ ...SNAPSHOT, strengthExperienceTier: tier }, "2026-10-14", counter("m")),
    });
    const f = created(buildFinalPrescriptionV2(manual("MODERATE", "intermediate")));
    expect([f.activeSessionOrigin, f.structure.family, mainIds(f), f.effectiveDurationMin]).toEqual(["manual_override_new_kind", "power", ["squat_jump", "broad_jump", "skater_jump", "dumbbell_swing"], 59]);
    expect(buildFinalPrescriptionV2(manual("MODERATE", "beginner"))).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "no_compatible_power_exercise", athleteTier: "beginner", available: [], target: "POWER" },
    });
    expect(buildFinalPrescriptionV2(manual("LIGHT", "intermediate"))).toMatchObject({ status: "blocked", detail: { reason: "power_load_not_supported" } });
  });
});

describe("V2-PHYS-INTEGRATION-01 — a REPLACE by the power kind needs the power switch", () => {
  it("power on: M1's REPLACE of a Force session by POWER → the catalogue power session (v2.replace.power); power off: unsupported, as before PHYS", () => {
    const on = created(buildFinalPrescriptionV2(input(UPPER, "REPLACE", { kind: "POWER", loadProfile: "MODERATE" })));
    expect([on.structure.family, on.reconciliationAction, on.adaptationRuleIds]).toEqual(["power", "replace", ["v2.replace.power"]]);
    const off = buildFinalPrescriptionV2({ ...input(UPPER, "REPLACE", { kind: "POWER", loadProfile: "MODERATE" }), phys: { ...PHYS_ON, power: false } });
    expect(off).toMatchObject({ status: "blocked", detail: { reason: "replace_target_not_supported", target: "POWER" } });
  });

  it("power off: a power session already in the accepted plan keeps its own rules (KEEP copy), never closed under the rider", () => {
    const kept = created(buildFinalPrescriptionV2({ ...input(POWER_SESSION, "KEEP", KEEP_POWER), phys: {} }));
    expect([kept.structure.family, kept.reconciliationAction]).toEqual(["power", "keep"]);
  });
});
