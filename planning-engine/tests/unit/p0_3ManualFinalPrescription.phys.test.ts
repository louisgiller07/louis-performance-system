/**
 * V2-PHYS-INTEGRATION-01 (HPM 2026-10-18) — a MANUAL session (P0-3) of a PHYS family (intervals, power, mobility) gets
 * a document only while its own switch is on; off, it is refused exactly as before PHYS (p0_3ManualFinalPrescription
 * .test.ts, the production test kept unchanged). PHYS-01.1 under the rider's time only with the PHYS daily switch.
 */
import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  dailyAdaptationContextV2,
  DAILY_ADAPTATION_RULES_V2,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type FinalPrescriptionV2Result,
  type PhysSwitchesV2,
  type PlanInputSnapshotV2,
} from "../../src/sessionModelV2/index.js";
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

const withPhys = (input: BuildFinalPrescriptionV2Input, phys: PhysSwitchesV2): BuildFinalPrescriptionV2Input => ({ ...input, phys });
const ALL_ON: PhysSwitchesV2 = { daily: true, intervals: true, power: true, mobility: true };

describe("V2-PHYS-INTEGRATION-01 — a manual session of a PHYS family needs its own switch", () => {
  const FAMILIES = [
    ["AEROBIC_INTERVALS", "intervals", "endurance"],
    ["POWER", "power", "power"],
    ["MOBILITY", "mobility", "mobility"],
  ] as const;

  it.each(FAMILIES)("%s: every switch off → refused as before PHYS (manual_kind_not_supported)", (kind) => {
    const r = buildFinalPrescriptionV2(manualInput("KEEP", { kind, loadProfile: "MODERATE" }));
    expect(r).toMatchObject({ status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "manual_kind_not_supported", target: kind } });
  });

  it.each(FAMILIES)("%s: every other switch on, its own off → still refused", (kind, switchName) => {
    const others: PhysSwitchesV2 = { ...ALL_ON, [switchName]: false };
    const r = buildFinalPrescriptionV2(withPhys(manualInput("KEEP", { kind, loadProfile: "MODERATE" }), others));
    expect(r).toMatchObject({ status: "blocked", detail: { reason: "manual_kind_not_supported", target: kind } });
  });

  it.each(FAMILIES)("%s: its own switch on → the catalogue session, manual contract", (kind, switchName, family) => {
    const r = created(buildFinalPrescriptionV2(withPhys(manualInput("KEEP", { kind, loadProfile: "MODERATE" }), { [switchName]: true })));
    expect([r.finalPrescription.structure.family, r.finalPrescription.structure.sessionKind, r.finalPrescription.activeSessionOrigin]).toEqual([family, kind, "manual_override_new_kind"]);
  });

  it("the PHYS daily switch opens no family", () => {
    for (const [kind] of FAMILIES) {
      const r = buildFinalPrescriptionV2(withPhys(manualInput("KEEP", { kind, loadProfile: "MODERATE" }), { daily: true, performanceGuidance: true }));
      expect(r).toMatchObject({ status: "blocked", detail: { reason: "manual_kind_not_supported", target: kind } });
    }
  });

  it("intervals on: a rider-chosen LIGHT intervals session (KEEP) is refused, never an empty session (PHYS-02.1); off: refused as an unsupported kind", () => {
    const on = buildFinalPrescriptionV2(withPhys(manualInput("KEEP", { kind: "AEROBIC_INTERVALS", loadProfile: "LIGHT" }), { intervals: true }));
    expect(on).toMatchObject({ status: "blocked", detail: { reason: "manual_load_not_supported", target: "AEROBIC_INTERVALS" } });
    const off = buildFinalPrescriptionV2(manualInput("KEEP", { kind: "AEROBIC_INTERVALS", loadProfile: "LIGHT" }));
    expect(off).toMatchObject({ status: "blocked", detail: { reason: "manual_kind_not_supported", target: "AEROBIC_INTERVALS" } });
  });
});

describe("V2-PHYS-INTEGRATION-01 — A10 on a manual Force session", () => {
  const timed = (availableMinutes: number, finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"], phys?: PhysSwitchesV2) =>
    buildFinalPrescriptionWithinTodayTimeV2({ ...manualInput("KEEP", finalSession), ...(phys ? { phys } : {}), availableMinutes });

  it("PHYS daily on (PHYS-01.1, same dose for time): + 45 min → all exercises, no cool-down added here (39); + 30 min → the principal alone (24); + 90 → fits (39)", () => {
    const f45 = timed(45, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { daily: true });
    expect(f45.status === "created" && [f45.finalPrescription.structure.sessionKind, f45.effectiveDurationMin, f45.timeConstraint?.action]).toEqual(["STRENGTH_UPPER", 39, "fits"]);
    const f30 = timed(30, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { daily: true });
    expect(f30.status === "created" && [f30.finalPrescription.structure.sessionKind, f30.effectiveDurationMin, f30.finalPrescription.adaptationRuleIds]).toEqual([
      "STRENGTH_UPPER",
      24,
      [DAILY_ADAPTATION_RULES_V2.manualSession, DAILY_ADAPTATION_RULES_V2.strengthShortened, DAILY_ADAPTATION_RULES_V2.todayTimeLimit],
    ]);
    const f90 = timed(90, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" }, { daily: true });
    expect(f90.status === "created" && [f90.effectiveDurationMin, f90.timeConstraint?.action]).toEqual([39, "fits"]);
  });

  it("PHYS daily off: as before PHYS — + 45 min → its LIGHT 45-min dose; + 30 min → active recovery; + 90 → fits (60)", () => {
    const f45 = timed(45, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" });
    expect(f45.status === "created" && [f45.finalPrescription.structure.sessionKind, f45.effectiveDurationMin]).toEqual(["STRENGTH_UPPER", 45]);
    const f30 = timed(30, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" });
    expect(f30.status === "created" && f30.finalPrescription.structure.sessionKind).toBe("RECOVERY_ACTIVE");
    const f90 = timed(90, { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" });
    expect(f90.status === "created" && [f90.effectiveDurationMin, f90.timeConstraint?.action]).toEqual([60, "fits"]);
  });
});
