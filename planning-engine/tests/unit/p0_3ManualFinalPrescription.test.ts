/**
 * P0-3 (HPM 2026-10-13) — the final prescription of a MANUAL session (planned_sessions.source = 'manual'):
 * built from the rider's V2 context for M1's final kind, contract manual_override_new_kind / replace, A10 applied.
 */
import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  dailyAdaptationContextV2,
  DAILY_ADAPTATION_RULES_V2,
  sportFingerprint,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
} from "../../src/sessionModelV2/index.js";
import { SESSION_EXERCISE_CATALOG_V2 } from "../../src/catalog/sessionExerciseCatalogV2.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const DATE = "2026-10-13";
const EQUIPMENT = ["dumbbells", "bench"];

function snapshot(windows = ALL_DAY): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows, exceptions: [] },
    equipment: EQUIPMENT,
    terrainAccess: ["flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
    dhTechnicalTier: "intermediate",
  };
}
function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}
function manualInput(decision: BuildFinalPrescriptionV2Input["decision"]["decision"], finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"], over: { covers?: boolean; snap?: PlanInputSnapshotV2; adaptation?: null; stale?: boolean } = {}): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "f",
    decision: { decisionId: "d", decision, finalSession },
    lineage: {
      plannedSessionSource: "manual",
      // A manual row written before F3 may still carry the generated lineage it replaced: it must be ignored.
      sourcePlanVersionId: over.stale ? "old-version" : null,
      sourceGeneratedSessionId: over.stale ? "old-session" : null,
      currentPlanVersionId: "current-version",
      generatedSession: null,
      currentPlanCoversDate: over.covers ?? true,
    },
    plannedPrescription: null,
    adaptation: over.adaptation === null ? null : dailyAdaptationContextV2(over.snap ?? snapshot(), DATE, counter("b")),
  };
}
function created(r: FinalPrescriptionV2Result) {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  expect(validatePrescriptionV2(r.finalPrescription.structure, { stage: "final" })).toMatchObject({ ok: true });
  return r;
}
const exercises = (r: ReturnType<typeof created>) => r.finalPrescription.structure.blocks.flatMap((b) => b.items).filter((i) => i.kind === "exercise").map((i) => (i as { exerciseId: string }).exerciseId);

describe("P0-3 — manual Force: the rider's explicit kind, equipment and dose", () => {
  it("Force haut du corps (KEEP): a complete upper-body session, owned equipment, MODERATE dose 60 min, manual contract", () => {
    const r = created(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" })));
    const fp = r.finalPrescription;
    // HPM P1 — the action mirrors M1's KEEP; a keep carries no adaptation rule (persist_daily_run_v2 / table constraint).
    expect([fp.activeSessionOrigin, fp.reconciliationAction, fp.planVersionId, fp.plannedPrescriptionId]).toEqual(["manual_override_new_kind", "keep", "current-version", undefined]);
    expect(fp.adaptationRuleIds).toEqual([]);
    expect([fp.structure.family, fp.structure.sessionKind, r.effectiveDurationMin]).toEqual(["strength", "STRENGTH_UPPER", 60]);
    const ids = exercises(r);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const e = SESSION_EXERCISE_CATALOG_V2[id]!;
      expect(e.requiredEquipment.every((x) => EQUIPMENT.includes(x)), id).toBe(true);
    }
  });

  it("Force jambes is a lower-body session, never the upper one; LIGHT is the 45-min dose", () => {
    const lower = created(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_LOWER", loadProfile: "LIGHT" })));
    expect([lower.finalPrescription.structure.sessionKind, lower.effectiveDurationMin]).toEqual(["STRENGTH_LOWER", 45]);
    const upper = created(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" })));
    expect(exercises(lower)).not.toEqual(exercises(upper));
  });

  it("a HEAVY manual Force is refused explicitly (no validated V2 heavy dose), never silently lightened", () => {
    expect(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "HEAVY" }))).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "manual_load_not_supported", target: "STRENGTH_UPPER", loadProfile: "HEAVY" },
    });
  });
});

describe("P0-3 — preconditions and refusals", () => {
  // PHYS-02 — AEROBIC_INTERVALS has a builder now (catalogue session at MODERATE; see phys02EnduranceDaily.test.ts).
  it.each(["POWER", "GRIP_WORK", "PUMPTRACK", "BIKE_MAINTENANCE", "STRENGTH_FULL_LIGHT", "MOBILITY", "DH_PERFORMANCE"])("%s: explicit refusal, never an empty session", (kind) => {
    const r = buildFinalPrescriptionV2(manualInput("KEEP", { kind, loadProfile: "MODERATE" }));
    expect(r).toMatchObject({ status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "manual_kind_not_supported", target: kind } });
  });

  it("REST stays REST: no document", () => {
    expect(buildFinalPrescriptionV2(manualInput("REST", { kind: "REST" })).status).toBe("none");
  });

  it("a date the current plan does not cover: refused (the manual_override_new_kind precondition)", () => {
    expect(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { covers: false }))).toEqual({
      status: "blocked",
      code: "final_prescription_no_lineage",
      detail: { reason: "manual_session_outside_current_plan" },
    });
  });

  it("no V2 context: refused, never an invented session", () => {
    expect(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { adaptation: null }))).toMatchObject({ status: "blocked", detail: { reason: "no_adaptation_context" } });
  });

  it("a manual DH on a day without a riding window: refused (riding_not_available)", () => {
    const physicalOnly = ALL_DAY.map((w) => ({ ...w, activity: "physical" as const }));
    expect(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 }, { snap: snapshot(physicalOnly) }))).toMatchObject({ status: "blocked", detail: { reason: "riding_not_available" } });
  });

  it("a stale generated lineage left on a manual row is ignored: the manual session is built", () => {
    const r = created(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { stale: true })));
    expect(r.finalPrescription.activeSessionOrigin).toBe("manual_override_new_kind");
  });
});

describe("P0-3 — A10 applies to manual sessions like to generated ones", () => {
  const timed = (availableMinutes: number, finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]) => buildFinalPrescriptionWithinTodayTimeV2({ ...manualInput("KEEP", finalSession), availableMinutes });

  it("manual DH 90 min + 30 min available → never a 90-min prescription: active recovery fitted to 30 min, traced", () => {
    const r = timed(30, { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 });
    expect(r.status).toBe("created");
    if (r.status !== "created") return;
    expect(r.timeConstraint).toMatchObject({ availableMinutes: 30, action: "adapted", before: { decision: "KEEP", kind: "DH_TECHNICAL", durationMin: 90 }, after: { decision: "REPLACE", kind: "RECOVERY_ACTIVE" } });
    expect(r.finalPrescription.structure.sessionKind).toBe("RECOVERY_ACTIVE");
    expect(r.finalPrescription.structure.blocks.reduce((s, b) => s + (b.durationMinutes?.max ?? 0), 0)).toBeLessThanOrEqual(30);
    expect(r.finalPrescription.adaptationRuleIds).toEqual([DAILY_ADAPTATION_RULES_V2.manualSession, DAILY_ADAPTATION_RULES_V2.replaceRecovery, DAILY_ADAPTATION_RULES_V2.todayTimeLimit]);
    expect([r.finalPrescription.activeSessionOrigin, r.finalPrescription.reconciliationAction]).toEqual(["manual_override_new_kind", "replace"]);
  });

  it("manual DH 90 min + 60 min available → the 60-min DH window, same family", () => {
    const r = timed(60, { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: 90 });
    expect(r.status === "created" && [r.finalPrescription.structure.sessionKind, r.effectiveDurationMin, r.timeConstraint?.action]).toEqual(["DH_TECHNICAL", 60, "adapted"]);
  });

  it("manual Force MODERATE (PHYS-01.1, same dose for time): + 45 min → all exercises, no cool-down added here (39); + 30 min → the principal alone (24); + 90 → fits (39)", () => {
    const f45 = timed(45, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" });
    expect(f45.status === "created" && [f45.finalPrescription.structure.sessionKind, f45.effectiveDurationMin, f45.timeConstraint?.action]).toEqual(["STRENGTH_UPPER", 39, "fits"]);
    const f30 = timed(30, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" });
    expect(f30.status === "created" && [f30.finalPrescription.structure.sessionKind, f30.effectiveDurationMin, f30.finalPrescription.adaptationRuleIds]).toEqual([
      "STRENGTH_UPPER",
      24,
      [DAILY_ADAPTATION_RULES_V2.manualSession, DAILY_ADAPTATION_RULES_V2.strengthShortened, DAILY_ADAPTATION_RULES_V2.todayTimeLimit],
    ]);
    const f90 = timed(90, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" });
    expect(f90.status === "created" && [f90.effectiveDurationMin, f90.timeConstraint?.action]).toEqual([39, "fits"]);
  });
});

describe("P0-3 — the action mirrors M1's decision", () => {
  it("MODIFY → modify with the manual + builder rules; REPLACE → replace", () => {
    const m = created(buildFinalPrescriptionV2(manualInput("MODIFY", { kind: "STRENGTH_UPPER", loadProfile: "LIGHT" })));
    expect([m.finalPrescription.reconciliationAction, m.finalPrescription.adaptationRuleIds]).toEqual(["modify", [DAILY_ADAPTATION_RULES_V2.manualSession, DAILY_ADAPTATION_RULES_V2.replaceStrength]]);
    const r = created(buildFinalPrescriptionV2(manualInput("REPLACE", { kind: "RECOVERY_ACTIVE" })));
    expect([r.finalPrescription.reconciliationAction, r.finalPrescription.adaptationRuleIds]).toEqual(["replace", [DAILY_ADAPTATION_RULES_V2.manualSession, DAILY_ADAPTATION_RULES_V2.replaceRecovery]]);
  });
});

describe("P0-3 — determinism (replay)", () => {
  it("the same inputs give the same sport content (ids aside)", () => {
    const a = created(buildFinalPrescriptionV2(manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" })));
    const b = created(buildFinalPrescriptionV2({ ...manualInput("KEEP", { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }), adaptation: dailyAdaptationContextV2(snapshot(), DATE, counter("c")) }));
    expect(sportFingerprint(a.finalPrescription.structure)).toBe(sportFingerprint(b.finalPrescription.structure));
  });
});
