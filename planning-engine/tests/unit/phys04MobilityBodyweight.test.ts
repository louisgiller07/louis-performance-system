import { describe, expect, it } from "vitest";
import {
  assignPrescriptionIds,
  attachBodyweightRepsGuidanceV2,
  bodyweightRepsGuidanceV2,
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  buildMobilityPrescriptionV2Content,
  buildSessionModelV2CatalogManifest,
  buildStrengthPrescriptionV2Content,
  dailyAdaptationContextV2,
  generatePlanV2InMemory,
  sportFingerprint,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type ExerciseItemV2,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2,
  type StrengthExerciseSessionRecordV2,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";
// V2-PHYS-INTEGRATION-01 — these PHYS rules run with their switches ON (every switch off: the production behaviour,
// proven by the production tests kept unchanged and by phys00FlagsOffEquivalence).
const PHYS_ON = { daily: true, intervals: true, power: true, mobility: true } as const;

// PHYS-04 — mobility sessions (the catalogue protocol, guided, recorded) and bodyweight progression on
// repetitions (the rider's own recorded sets; never a load, never another exercise imposed).

const catalog = buildSessionModelV2CatalogManifest();
function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}
const minutes = (p: { blocks: readonly { durationMinutes?: { min: number; max: number } }[] }) => p.blocks.map((b) => [b.durationMinutes!.min, b.durationMinutes!.max]);

describe("PHYS-04 — the mobility session (mobility_routine_v1, unchanged)", () => {
  it("zones in order, every exercise in duration at its catalogue reference, breathing last; 22–30 min; no dose invented", () => {
    const c = buildMobilityPrescriptionV2Content({ catalog });
    expect(c).toMatchObject({ family: "mobility", sessionKind: "MOBILITY", intentId: "mobility_on_bike_range", protocolId: "mobility_routine_v1" });
    expect(c.blocks.map((b) => [b.role, b.focus, b.items.map((i) => (i as { exerciseId: string }).exerciseId)])).toEqual([
      ["main", "hips", ["hip_90_90", "hip_flexor_mobility", "deep_squat_hold"]],
      ["main", "ankles", ["knee_to_wall_ankle"]],
      ["main", "spine", ["cat_cow", "thoracic_rotation_mobility"]],
      ["main", "wrists", ["wrist_mobility"]],
      ["cool_down", "breathing", ["breathing_long_exhale"]],
    ]);
    expect(minutes(c)).toEqual([[9, 11], [3, 4], [5, 7], [2, 3], [3, 5]]);
    expect(c.blocks.flatMap((b) => b.items).every((i) => i.kind === "exercise" && i.sets === 1 && i.measure.type === "duration")).toBe(true);
    expect(c.blocks[0]!.instructionIds).toEqual(["instruction.mobility.slow_and_breathe"]);
    expect(JSON.stringify(c)).not.toMatch(/"rpeTarget"|"loadKg"|"loadGuidance"|"targetKg"/);
    expect(validatePrescriptionV2(assignPrescriptionIds(c, counter("m"))).ok).toBe(true);
  });

  it("at its minimum (the rider's time): every block at its protocol minimum, 22 min, never below", () => {
    const c = buildMobilityPrescriptionV2Content({ catalog, atMinimum: true });
    expect(minutes(c)).toEqual([[9, 9], [3, 3], [5, 5], [2, 2], [3, 3]]);
    expect(minutes(c).reduce((t, [, max]) => t + max!, 0)).toBe(22);
  });
});

const allDay = (start: string, end: string): PlanInputAvailabilityWindow[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: start, endTime: end }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: allDay("08:00", "20:00"), exceptions: [] },
  equipment: [],
  terrainAccess: ["flow_trail", "bermed_trail"],
  strengthExperienceTier: "beginner",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  dhTechnicalTier: "intermediate",
};
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-11-15" };
function plan(snapshot: PlanInputSnapshotV2, mobilitySessions?: boolean): PlanV2InMemory {
  const r = generatePlanV2InMemory({ block: BLOCK, snapshot, mintId: counter("a"), ...(mobilitySessions !== undefined ? { mobilitySessions } : {}) });
  if (r.status !== "generated") throw new Error(r.status);
  return r.plan;
}
const OFF = plan(SNAPSHOT);
const ON = plan(SNAPSHOT, true);

describe("PHYS-04 — mobility in the plan (server option only)", () => {
  it("without the option: no mobility session — the previous plan", () => {
    expect(JSON.stringify(OFF)).not.toMatch(/"MOBILITY"|mobility_session|mobilityPolicy/);
    expect(plan(SNAPSHOT, false)).toEqual(OFF);
  });

  it("with the option: one mobility session on the first free day of the consolidation week (30 min), the week's counts following it; everything else unchanged", () => {
    const mob = ON.weeks.flatMap((w) => w.sessions.filter((s) => s.kind === "MOBILITY").map((s) => [w.doseSummary.progression!.role, s.date, s.durationMin, s.loadProfile ?? null]));
    expect(mob).toEqual([["consolidation", "2026-10-28", 30, null]]);
    const week = ON.weeks[3]!;
    expect(week.sessions.map((s) => [s.date, s.kind])).toEqual([["2026-10-26", "DH_TECHNICAL"], ["2026-10-27", "STRENGTH_LOWER"], ["2026-10-28", "MOBILITY"]]);
    const off = OFF.weeks[3]!.doseSummary;
    expect(week.doseSummary).toMatchObject({ plannedRestOrRecoveryDayCount: off.plannedRestOrRecoveryDayCount - 1, totalPlannedMinutes: off.totalPlannedMinutes + 30 });
    expect(week.doseSummary.progression).toMatchObject({ sessionCount: off.progression!.sessionCount + 1, mobilityPolicy: "mobility-plan-v1" });
    expect(week.doseSummary.progression!.reasonCodes.at(-1)).toBe("mobility_session");
    expect(week.rationale).toContain("A mobility session is added on a free day this week.");
    const others = (p: PlanV2InMemory) => p.weeks.flatMap((w) => w.sessions.filter((s) => s.kind !== "MOBILITY").map((s) => s.sportFingerprint));
    expect(others(ON)).toEqual(others(OFF));
  });

  it("no free day whose window holds 30 minutes: no mobility session added (never a second session on a day)", () => {
    const short = plan({ ...SNAPSHOT, availability: { windows: allDay("08:00", "08:25"), exceptions: [] } }, true);
    expect(JSON.stringify(short)).not.toMatch(/"MOBILITY"/);
  });
});

// --- Daily (mobility) -------------------------------------------------------------------------------

const MOBILITY_SESSION = ON.weeks[3]!.sessions.find((s) => s.kind === "MOBILITY")!;
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
function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}
const KEEP_MOBILITY = { kind: "MOBILITY", durationMin: 30 };

describe("PHYS-04 — daily mobility", () => {
  it("KEEP: the planned mobility session verbatim", () => {
    const f = created(buildFinalPrescriptionV2(input(MOBILITY_SESSION, "KEEP", KEEP_MOBILITY)));
    expect([f.reconciliationAction, f.structure.blocks]).toEqual(["keep", MOBILITY_SESSION.plannedPrescription.structure.blocks]);
  });

  it("A10 — 30 min fits; 25 min: the protocol minimum (22 min); 20 min: active recovery; 15 min: rest", () => {
    expect(buildFinalPrescriptionWithinTodayTimeV2({ ...input(MOBILITY_SESSION, "KEEP", KEEP_MOBILITY), availableMinutes: 30 }).timeConstraint?.action).toBe("fits");
    const r25 = buildFinalPrescriptionWithinTodayTimeV2({ ...input(MOBILITY_SESSION, "KEEP", KEEP_MOBILITY), availableMinutes: 25 });
    expect([created(r25).reconciliationAction, created(r25).adaptationRuleIds, minutes(created(r25).structure)]).toEqual([
      "modify",
      ["v2.time.mobility_minimum", "v2.time.today_limit"],
      [[9, 9], [3, 3], [5, 5], [2, 2], [3, 3]],
    ]);
    expect(buildFinalPrescriptionWithinTodayTimeV2({ ...input(MOBILITY_SESSION, "KEEP", KEEP_MOBILITY), availableMinutes: 20 }).timeConstraint).toMatchObject({ action: "adapted", after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } });
    expect(buildFinalPrescriptionWithinTodayTimeV2({ ...input(MOBILITY_SESSION, "KEEP", KEEP_MOBILITY), availableMinutes: 15 }).timeConstraint?.action).toBe("rest");
  });

  it("REST stays REST; a manual mobility session gets the protocol session", () => {
    expect(buildFinalPrescriptionV2(input(MOBILITY_SESSION, "REST" as "KEEP", { kind: "REST" })).status).toBe("none");
    const manual: BuildFinalPrescriptionV2Input = {
      finalPrescriptionId: "f",
      decision: { decisionId: "d", decision: "KEEP", finalSession: { kind: "MOBILITY" } },
      phys: PHYS_ON, lineage: { plannedSessionSource: "manual", sourcePlanVersionId: null, sourceGeneratedSessionId: null, currentPlanVersionId: ON.planVersionId, generatedSession: null, currentPlanCoversDate: true },
      plannedPrescription: null,
      adaptation: dailyAdaptationContextV2(SNAPSHOT, "2026-10-29", counter("x")),
    };
    const f = created(buildFinalPrescriptionV2(manual));
    expect([f.activeSessionOrigin, f.structure.family, f.structure.protocolId]).toEqual(["manual_override_new_kind", "mobility", "mobility_routine_v1"]);
  });
});

// --- Bodyweight repetitions guidance -------------------------------------------------------------------

const sets = (reps: (number | null)[], rpe: number | null = 7) => reps.map((r, i) => ({ setNumber: i + 1, done: r !== null, reps: r, loadKg: null, rpe }));
const rec = (sessionDate: string, reps: (number | null)[], rpe: number | null = 7, prescribed = { sets: 4, reps: { min: 6, max: 8 }, rpeTarget: { min: 7, max: 8 } }): StrengthExerciseSessionRecordV2 => ({ sessionDate, prescribed, sets: sets(reps, rpe) });
const SQUAT = { exerciseId: "bodyweight_squat", sets: 4, measure: { type: "reps" as const, min: 6, max: 8, perSide: false }, rpeTarget: { min: 7, max: 8 } };
const guide = (history: StrengthExerciseSessionRecordV2[], item = SQUAT, todayHold?: "pain" | "fatigue") => bodyweightRepsGuidanceV2({ item, today: "2026-10-21", history, ...(todayHold ? { todayHold } : {}) });

describe("PHYS-04 — bodyweight progression on repetitions (explicit rules, no load, no imposed variant)", () => {
  it("nothing recorded: calibrate within the prescribed range, with the effort target (reps in reserve)", () => {
    expect(guide([])).toEqual({ ruleVersion: "bodyweight-reps-guidance-v1", mode: "calibrate", reason: "no_history", repsInReserve: { min: 2, max: 3 } });
  });

  it("every set done within the range, effort in target: one more repetition per set (from the lowest set), never above the range", () => {
    expect(guide([rec("2026-10-14", [6, 6, 7, 6])])).toMatchObject({ mode: "target", reason: "within_range", change: "increase", targetReps: 7 });
    expect(guide([rec("2026-10-14", [7, 7, 7, 7])])).toMatchObject({ change: "increase", targetReps: 8 });
  });

  it("top of the range on every set: keep the top — and say the catalogue has no harder variant without equipment (never imposed)", () => {
    expect(guide([rec("2026-10-14", [8, 8, 8, 8])])).toMatchObject({ mode: "target", reason: "top_of_range_reached", change: "keep", targetReps: 8, nextStep: "no_bodyweight_variant" });
  });

  it("effort too high (RPE ≥ target max + 2) or a set below the range: back to the range's minimum", () => {
    expect(guide([rec("2026-10-14", [8, 8, 8, 8], 10)])).toMatchObject({ reason: "effort_too_high", change: "decrease", targetReps: 6 });
    expect(guide([rec("2026-10-14", [7, 6, 5, 5])])).toMatchObject({ reason: "below_range", change: "decrease", targetReps: 6 });
  });

  it("holds (one lever at a time, today's state): pain / M1 fatigue / a heavier dose today keep the repetitions; effort above target keeps them too", () => {
    expect(guide([rec("2026-10-14", [6, 6, 6, 6])], SQUAT, "pain")).toMatchObject({ change: "keep", targetReps: 6, hold: "pain" });
    expect(guide([rec("2026-10-14", [6, 6, 6, 6])], { ...SQUAT, sets: 5 })).toMatchObject({ change: "keep", targetReps: 6, hold: "dose_up" });
    expect(guide([rec("2026-10-14", [6, 6, 6, 6], 9)])).toMatchObject({ reason: "within_range", change: "keep", targetReps: 6 });
  });

  it("a missed session: the reference stays the last session done (within 28 days); older, or another range → shown, never converted", () => {
    expect(guide([rec("2026-10-07", [6, 6, 6, 6])])).toMatchObject({ mode: "target", change: "increase", targetReps: 7, reference: { sessionDate: "2026-10-07" } });
    expect(guide([rec("2026-09-20", [6, 6, 6, 6])])).toMatchObject({ mode: "reference", reason: "history_too_old" });
    expect(guide([rec("2026-10-14", [9, 9, 9], 6, { sets: 3, reps: { min: 8, max: 10 }, rpeTarget: { min: 5, max: 6 } })])).toMatchObject({ mode: "reference", reason: "different_dose", reference: { reps: [9, 9, 9] } });
  });

  it("only bodyweight work exercises in repetitions: a loaded or a duration exercise gets none", () => {
    expect(guide([], { ...SQUAT, exerciseId: "goblet_squat" })).toBeNull();
    expect(guide([], { ...SQUAT, exerciseId: "plank", measure: { type: "duration", minSeconds: 30, maxSeconds: 45, perSide: false } as never })).toBeNull();
  });

  it("attached to a beginner's final Force session (no equipment), validated at that place only, never sport content", () => {
    const content = buildStrengthPrescriptionV2Content({ sessionKind: "STRENGTH_LOWER", athleteTier: "beginner", equipment: [], loadProfile: "MODERATE", catalog });
    const structure = assignPrescriptionIds(content, counter("s")) as PrescriptionV2;
    const guided = attachBodyweightRepsGuidanceV2(structure, "2026-10-21", { bodyweight_squat: [rec("2026-10-14", [6, 6, 6, 6])] });
    const work = guided.blocks.filter((b) => b.role !== "warm_up").flatMap((b) => b.items as readonly ExerciseItemV2[]);
    expect(work.map((i) => [i.exerciseId, i.repsGuidance?.mode ?? null])).toEqual([["bodyweight_squat", "target"], ["glute_bridge", "calibrate"], ["reverse_lunge", "calibrate"]]);
    expect(validatePrescriptionV2(guided, { stage: "final" }).ok).toBe(true);
    expect(validatePrescriptionV2(guided)).toMatchObject({ ok: false, issues: [{ code: "reps_guidance_not_allowed" }, { code: "reps_guidance_not_allowed" }, { code: "reps_guidance_not_allowed" }] });
    expect(sportFingerprint(guided)).toBe(sportFingerprint(structure));
    // Strict shape: an unknown key or an impossible combination is refused.
    const first = guided.blocks.find((b) => b.role === "main")!.items[0] as ExerciseItemV2;
    const bad = { ...guided, blocks: guided.blocks.map((b) => (b.role === "main" ? { ...b, items: [{ ...first, repsGuidance: { ...first.repsGuidance!, kg: 10 } }] } : b)) };
    expect(validatePrescriptionV2(bad, { stage: "final" }).ok).toBe(false);
  });
});

describe("V2-PHYS-INTEGRATION-01 — a REPLACE by the mobility kind needs the mobility switch", () => {
  const anySession = ON.weeks[3]!.sessions.find((s) => s.kind !== "MOBILITY" && s.kind !== "REST")!;

  it("mobility on: M1's REPLACE by MOBILITY → the protocol session (v2.replace.mobility); mobility off: unsupported, as before PHYS", () => {
    const on = created(buildFinalPrescriptionV2(input(anySession, "REPLACE", { kind: "MOBILITY" })));
    expect([on.structure.family, on.reconciliationAction, on.adaptationRuleIds]).toEqual(["mobility", "replace", ["v2.replace.mobility"]]);
    const off = buildFinalPrescriptionV2({ ...input(anySession, "REPLACE", { kind: "MOBILITY" }), phys: { ...PHYS_ON, mobility: false } });
    expect(off).toMatchObject({ status: "blocked", detail: { reason: "replace_target_not_supported", target: "MOBILITY" } });
  });

  it("mobility off: a mobility session already in the accepted plan keeps its own rules (KEEP copy)", () => {
    const kept = created(buildFinalPrescriptionV2({ ...input(MOBILITY_SESSION, "KEEP", KEEP_MOBILITY), phys: {} }));
    expect([kept.structure.family, kept.reconciliationAction]).toEqual(["mobility", "keep"]);
  });
});
