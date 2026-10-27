/**
 * V2-CONTRACTS-INTEGRATION-01 (HPM 2026-10-26) — the DH unit, duration (C1) and RPE contracts are used where V2
 * sessions are built: plan generation (every session's `contractChecks`) and the daily final prescription (RPE and
 * one end on every document it builds). Checks only: no dose, count, block or duration changes; the progression and
 * race contracts stay dormant. Doses come from the PROVISIONAL V2 content: the assertions check the wiring.
 */
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as checksModule from "../../src/sessionModelV2/contracts/sessionContractChecksV2.js";
import {
  addDhRepetitionsV2,
  assessProgressionCandidateV2,
  buildFinalPrescriptionV2,
  checkSessionContractsV2,
  countEndBlocksV2,
  dhQuotaChecksV2,
  generatePlanV2InMemory,
  sessionDurationCheckV2,
  toSessionModelV2Input,
  type BuildFinalPrescriptionV2Input,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2Content,
} from "../../src/sessionModelV2/index.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionDrillCatalogV2.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// The real module, wrapped to record which consumer calls it (behaviour unchanged).
const calls = vi.hoisted(() => ({ generation: [] as string[], daily: [] as string[] }));
vi.mock("../../src/sessionModelV2/contracts/sessionContractChecksV2.js", async (importOriginal) => {
  const real = await importOriginal<typeof checksModule>();
  return {
    ...real,
    checkSessionContractsV2: (...args: Parameters<typeof real.checkSessionContractsV2>) => (calls.generation.push(args[2]), real.checkSessionContractsV2(...args)),
    assertSessionContentContractsV2: (...args: Parameters<typeof real.assertSessionContentContractsV2>) => (calls.daily.push(args[1]), real.assertSessionContentContractsV2(...args)),
  };
});

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const w = (dayOfWeek: PlanInputAvailabilityWindow["dayOfWeek"], startTime: string, endTime: string, activity: "physical" | "riding"): PlanInputAvailabilityWindow => ({ dayOfWeek, startTime, endTime, activity });
const WEEKDAYS_WEEKEND = [w(1, "18:00", "20:00", "physical"), w(2, "18:00", "19:30", "physical"), w(3, "18:00", "20:00", "physical"), w(4, "18:00", "19:30", "physical"), w(5, "18:00", "20:00", "physical"), w(6, "09:00", "17:00", "riding"), w(0, "09:00", "17:00", "riding")];
const NO_HISTORY = { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 };

function snapshot(overrides: Partial<PlanInputSnapshotV2> = {}): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: NO_HISTORY,
    dhTechnicalTier: "intermediate",
    ...overrides,
  };
}

const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-11-02", endDate: "2026-11-29" };
const counter = (prefix: string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
};

function plan(s: PlanInputSnapshotV2, options: { enduranceIntervals?: true; powerSessions?: true; mobilitySessions?: true } = {}): PlanV2InMemory {
  const result = generatePlanV2InMemory({ block: BLOCK, snapshot: s, mintId: counter("a"), ...options });
  if (result.status !== "generated") throw new Error(`expected a generated plan, got ${result.code}`);
  return result.plan;
}

const TRAINED = snapshot({ recentHistory: { ...NO_HISTORY, trailingVolumeMinutes: 240 } });
const PLANS = {
  development: plan(snapshot()),
  trained: plan(TRAINED),
  phys: plan(snapshot(), { enduranceIntervals: true, powerSessions: true, mobilitySessions: true }),
  race: plan(snapshot({ availability: { windows: WEEKDAYS_WEEKEND, exceptions: [] }, races: [{ eventName: "Course", startDate: "2026-11-21", endDate: "2026-11-22", priority: "A", raceFormat: "HOT_TRAIL_2DAY" }] })),
};
const sessionsOf = (p: PlanV2InMemory) => p.weeks.flatMap((x) => x.sessions);
const ALL = Object.values(PLANS).flatMap(sessionsOf);
const items = (s: PlanSessionV2InMemory) => s.plannedPrescription.structure.blocks.flatMap((b) => b.items);
const UNTIMED = ["briefMin", "warmUpMin", "rideMinPerRepetition", "climbMinPerRepetition", "pauseMinPerRepetition", "freeDescentsMin", "endMin"];

const trained = (kind: string) => {
  const s = sessionsOf(PLANS.trained).find((x) => x.kind === kind && x.loadProfile === "MODERATE");
  if (!s) throw new Error(`no MODERATE ${kind} session`);
  return s;
};

function dailyInput(s: PlanSessionV2InMemory, decision: "KEEP" | "MODIFY" | "REPLACE", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"], structure = JSON.parse(JSON.stringify(s.plannedPrescription.structure))): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: PLANS.trained.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: PLANS.trained.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure },
    adaptation: { athlete: toSessionModelV2Input(TRAINED), ridingAvailable: true, mintId: counter("b") },
    dailyMintId: counter("c"),
  };
}

function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("V2-CONTRACTS-INTEGRATION-01 · real consumers", () => {
  it("plan generation checks every session it builds; the daily final prescription checks every document, a KEEP copy included (V2-DH-UNIT-01)", () => {
    calls.generation.length = 0;
    const p = plan(TRAINED);
    expect(calls.generation).toHaveLength(sessionsOf(p).length);
    expect(sessionsOf(p).every((s) => s.contractChecks !== undefined)).toBe(true);

    calls.daily.length = 0;
    const force = trained("STRENGTH_LOWER");
    created(buildFinalPrescriptionV2(dailyInput(force, "KEEP", { kind: force.kind, loadProfile: "MODERATE", durationMin: force.durationMin })));
    expect(calls.daily).toEqual(["KEEP final prescription"]);
    created(buildFinalPrescriptionV2(dailyInput(force, "MODIFY", { kind: force.kind, loadProfile: "LIGHT" })));
    created(buildFinalPrescriptionV2(dailyInput(force, "REPLACE", { kind: "RECOVERY_ACTIVE" })));
    expect(calls.daily).toEqual(["KEEP final prescription", "MODIFY final prescription", "REPLACE final prescription"]);
  });
});

describe("V2-CONTRACTS-INTEGRATION-01 · A — DH quota: a known unit, or no count presented as valid", () => {
  const dh = ALL.filter((s) => s.kind === "DH_TECHNICAL");

  it("1 — BLOCKED: a new DH quota cannot carry an explicit unit (no unit in the drill catalogue, none in `pass`): every generated quota reads UNKNOWN, its count blocked, its stored measure unchanged", () => {
    expect(dh.length).toBeGreaterThan(0);
    expect(SESSION_DRILL_CATALOG_V2_ENTRIES.every((d) => !("unit" in d))).toBe(true);
    for (const s of dh) {
      const drills = items(s).filter((i) => i.kind === "drill");
      expect(drills).toHaveLength(1);
      const drill = drills[0]!;
      expect(Object.keys(drill.measure).sort()).toEqual(["count", "type"]);
      expect(s.contractChecks.dh).toEqual([
        {
          drillId: drill.drillId,
          storedCount: drill.measure.count,
          unit: "UNKNOWN",
          count: { status: "count_blocked", reason: "unit_unknown", dose: { unit: "UNKNOWN", repetitions: null, sessionBudgetMin: s.durationMin } },
          sessionPlan: { verdict: "NON VÉRIFIABLE", unknown: UNTIMED },
        },
      ]);
    }
    expect(ALL.filter((s) => s.kind !== "DH_TECHNICAL").every((s) => s.contractChecks.dh.length === 0)).toBe(true);
  });

  it("2 — an existing DH prescription (`pass`, unit UNKNOWN) stays readable: KEEP copies it verbatim, MODIFY only lowers its count, no unit is ever added or trusted", () => {
    const s = trained("DH_TECHNICAL");
    const stored = items(s).find((i) => i.kind === "drill")!;
    const keep = created(buildFinalPrescriptionV2(dailyInput(s, "KEEP", { kind: s.kind, loadProfile: "MODERATE", durationMin: s.durationMin })));
    expect(keep.structure).toEqual(s.plannedPrescription.structure);
    expect(dhQuotaChecksV2(keep.structure, s.durationMin).map((q) => [q.storedCount, q.unit, q.count.status])).toEqual([[stored.kind === "drill" ? stored.measure.count : -1, "UNKNOWN", "count_blocked"]]);

    const light = created(buildFinalPrescriptionV2(dailyInput(s, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" })));
    const lowered = light.structure.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill")!;
    if (lowered.kind !== "drill" || stored.kind !== "drill") throw new Error("drill expected");
    expect(Object.keys(lowered.measure).sort()).toEqual(["count", "type"]);
    expect(lowered.measure.count).toBeLessThanOrEqual(stored.measure.count);

    // A unit written into a stored `pass` is not trusted: the count is still read UNKNOWN and blocked.
    const smuggled = { ...keep.structure, blocks: keep.structure.blocks.map((b) => ({ ...b, items: b.items.map((i) => (i.kind === "drill" ? { ...i, measure: { ...i.measure, unit: "SECTION" } } : i)) })) };
    expect(dhQuotaChecksV2(smuggled as PrescriptionV2Content, s.durationMin).map((q) => [q.unit, q.count.status])).toEqual([["UNKNOWN", "count_blocked"]]);
  });

  it("3 — an ambiguous quota is refused, never converted: UNKNOWN is never added to a known unit, never checked against a budget, and no content names SECTION or FULL_RUN", () => {
    expect(addDhRepetitionsV2({ unit: "UNKNOWN", count: 5 }, { unit: "SECTION", count: 3 })).toBeNull();
    expect(addDhRepetitionsV2({ unit: "UNKNOWN", count: 5 }, { unit: "UNKNOWN", count: 3 })).toBeNull();
    expect(dh.every((s) => s.contractChecks.dh.every((q) => q.sessionPlan.verdict === "NON VÉRIFIABLE" && q.count.dose.repetitions === null))).toBe(true);
    const stored = JSON.stringify(ALL.map((s) => s.plannedPrescription));
    expect([stored.includes("SECTION"), stored.includes("FULL_RUN")]).toEqual([false, false]);
  });
});

describe("V2-CONTRACTS-INTEGRATION-01 · B — durations against the slot (C1), nothing removed", () => {
  it("4 — every session is checked against its slot: Force and power under C1, timed blocks summed, DH NON VÉRIFIABLE; R46 stays NON CONFORME with every block", () => {
    for (const s of ALL) {
      const d = s.contractChecks.duration;
      expect(d.slotMin).toBe(s.durationMin);
      switch (s.plannedPrescription.structure.family) {
        case "strength":
        case "power":
          expect([d.basis, d.verdict, d.overflowMin]).toEqual(["strength_c1", "CONFORME", 0]);
          expect(d.range!.maxMin).toBeLessThanOrEqual(s.durationMin);
          break;
        case "dh_technical":
          expect([d.basis, d.verdict, d.range, d.overflowMin]).toEqual(["not_timed", "NON VÉRIFIABLE", null, null]);
          break;
        case "recovery":
          expect([s.durationMin, d.basis, d.verdict, d.range, d.overflowMin]).toEqual([20, "blocks", "NON CONFORME", { minMin: 28, maxMin: 55 }, 35]);
          expect(s.plannedPrescription.structure.blocks.map((b) => [b.role, b.durationMinutes])).toEqual([
            ["main", { min: 20, max: 40 }],
            ["complementary", { min: 5, max: 10 }],
            ["cool_down", { min: 3, max: 5 }],
          ]);
          break;
        default:
          expect([d.basis, d.verdict]).toEqual(["blocks", "CONFORME"]);
      }
    }
    const families = new Set(ALL.map((s) => s.plannedPrescription.structure.family));
    expect([...families].sort()).toEqual(["dh_technical", "endurance", "mobility", "power", "recovery", "strength"]);
    // The SPORT-PLAN-03 prototype sheets never enter the official catalogue.
    const SRC = fileURLToPath(new URL("../../src", import.meta.url));
    expect(globSync("**/*.ts", { cwd: SRC }).filter((f) => /\b(FULL45|FULL60|FM7|END30|REC20)\b/.test(readFileSync(`${SRC}/${f}`, "utf8")))).toEqual([]);
  });

  it("4 — counter-proof: an overflowing slot is reported at the upper bound or in full, and the content is not touched", () => {
    const content = deepFreeze(JSON.parse(JSON.stringify(trained("STRENGTH_LOWER").plannedPrescription.structure)));
    const copy = JSON.stringify(content);
    const full = sessionDurationCheckV2(content, 120).range!;
    expect(sessionDurationCheckV2(content, full.maxMin - 1)).toMatchObject({ verdict: "NON CONFORME À LA BORNE HAUTE", overflowMin: 1 });
    expect(sessionDurationCheckV2(content, full.minMin - 1)).toMatchObject({ verdict: "NON CONFORME", overflowMin: full.maxMin - full.minMin + 1 });
    expect(JSON.stringify(content)).toBe(copy);
  });

  it("5 — one end: every session has at most one; a Force session's end is the daily cool-down; a second end is a contract error", () => {
    for (const s of ALL) {
      const structure = s.plannedPrescription.structure;
      expect(countEndBlocksV2(structure)).toBe(structure.family === "strength" ? 0 : 1);
      expect(s.contractChecks.duration.end).toBe(structure.family === "strength" ? "daily_cool_down" : "content");
    }
    const force = trained("STRENGTH_LOWER").plannedPrescription.structure;
    const end = { role: "cool_down" as const, instructionIds: [], items: [] };
    expect(() => checkSessionContractsV2({ ...force, blocks: [...force.blocks, end, end] }, 60, "test")).toThrow(/2 end blocks, C1 allows one/);
  });

  it("5 — daily: the Force cool-down is added once, never to a session that already ends", () => {
    const s = trained("STRENGTH_LOWER");
    const keep = created(buildFinalPrescriptionV2(dailyInput(s, "KEEP", { kind: s.kind, loadProfile: "MODERATE", durationMin: s.durationMin })));
    expect(countEndBlocksV2(keep.structure)).toBe(1);
    const again = created(buildFinalPrescriptionV2(dailyInput(s, "KEEP", { kind: s.kind, loadProfile: "MODERATE", durationMin: s.durationMin }, JSON.parse(JSON.stringify(keep.structure)))));
    expect(again.structure).toEqual(keep.structure);
    expect(countEndBlocksV2(created(buildFinalPrescriptionV2(dailyInput(s, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" }))).structure)).toBe(1);
  });
});

describe("V2-CONTRACTS-INTEGRATION-01 · C — the three RPEs at the boundaries", () => {
  it("6 — set RPE on Force work items, activity RPE on endurance and recovery blocks, none elsewhere; a misuse stops generation and the daily document", () => {
    for (const s of ALL) {
      const kinds = [...new Set(s.contractChecks.rpe.map((t) => t.kind))];
      const family = s.plannedPrescription.structure.family;
      expect(kinds).toEqual(family === "strength" ? ["set"] : family === "endurance" || family === "recovery" ? ["activity"] : []);
    }
    const force = trained("STRENGTH_LOWER").plannedPrescription.structure;
    const endurance = trained("AEROBIC_BASE").plannedPrescription.structure;
    const workItem = force.blocks.find((b) => b.role === "main")!.items[0]!;
    expect(() => checkSessionContractsV2({ ...endurance, blocks: [...endurance.blocks.slice(0, -1), { ...endurance.blocks.at(-1)!, items: [workItem] }] }, 60, "plan")).toThrow(/plan: RPE semantics violated \(blocks\[\d\]\.items\[0\]\.rpeTarget set_rpe_outside_strength\)/);
    expect(() => checkSessionContractsV2({ ...force, blocks: [{ ...force.blocks[0]!, rpeTarget: { min: 3, max: 4 } }, ...force.blocks.slice(1)] }, 60, "daily")).toThrow(/activity_rpe_outside_endurance_or_recovery/);
  });
});

describe("V2-CONTRACTS-INTEGRATION-01 · D — immutability, progression, V1", () => {
  it("7 — a frozen prescription and a completed execution's document are never changed: KEEP copies verbatim; the checks and the daily build read deep-frozen documents", () => {
    for (const kind of ["STRENGTH_LOWER", "DH_TECHNICAL", "AEROBIC_BASE"]) {
      const s = trained(kind);
      const frozen = deepFreeze(JSON.parse(JSON.stringify(s.plannedPrescription.structure)));
      const { dailyMintId: _noAddition, ...keepInput } = dailyInput(s, "KEEP", { kind, loadProfile: "MODERATE", durationMin: s.durationMin }, frozen);
      const keep = created(buildFinalPrescriptionV2(keepInput));
      expect(keep.structure).toEqual(s.plannedPrescription.structure);
      expect(keep.structure).not.toBe(frozen);
      created(buildFinalPrescriptionV2(dailyInput(s, "MODIFY", { kind, loadProfile: "LIGHT" }, frozen)));
      // The document of a completed execution, frozen: the checks read it without writing.
      const executed = deepFreeze(JSON.parse(JSON.stringify(keep.structure)));
      expect(checkSessionContractsV2(executed, s.durationMin, "executed")).toEqual(s.contractChecks);
      expect(executed).toEqual(s.plannedPrescription.structure);
    }
  });

  it("8 — no autonomous progression: the progression contract is wired nowhere, the default policy admits no rise, and the plan does not read the history's session kinds", () => {
    const SRC = fileURLToPath(new URL("../../src", import.meta.url));
    const files = globSync("**/*.ts", { cwd: SRC }).map((f) => f.replace(/\\/g, "/"));
    const read = (f: string) => readFileSync(`${SRC}/${f}`, "utf8");
    expect(files.filter((f) => /progressionContractV2/.test(read(f)) && f !== "sessionModelV2/contracts/progressionContractV2.ts")).toEqual(["sessionModelV2/contracts/index.ts"]);
    expect(files.filter((f) => /CANDIDATE_ONE_STEP_POLICY_V2|raceExposureV2|exposureLedgerV2/.test(read(f)) && !/^sessionModelV2\/contracts\/(progressionContractV2|raceExposureV2|index)\.ts$/.test(f))).toEqual([]);

    const reliable = { kind: "result" as const, outcome: "complete" as const, targetMet: true, healthSignal: false };
    const assessed = assessProgressionCandidateV2({ candidate: { dose: { family: "force", measure: "dose_step", step: "MODERATE" }, date: "2026-11-10" }, reference: { dose: { family: "force", measure: "dose_step", step: "LIGHT" }, date: "2026-11-03", source: "recorded" }, evidence: reliable });
    expect([assessed.riseAdmissible, assessed.admissibleMax, assessed.policy.id]).toEqual([false, { family: "force", measure: "dose_step", step: "LIGHT" }, "no_progression"]);

    const kinds = plan(snapshot({ recentHistory: { ...NO_HISTORY, recentSessionKinds: ["STRENGTH_LOWER", "DH_TECHNICAL", "DH_TECHNICAL", "AEROBIC_BASE"] } }));
    expect(JSON.stringify(kinds)).toBe(JSON.stringify(PLANS.development));
  });

  it("9 — V1 untouched: only the V2 generation, the V2 daily final prescription and the barrel use the contracts", () => {
    const SRC = fileURLToPath(new URL("../../src", import.meta.url));
    const importers = globSync("**/*.ts", { cwd: SRC })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !f.startsWith("sessionModelV2/contracts/"))
      .filter((f) => /from\s+["'][^"']*contracts\//.test(readFileSync(`${SRC}/${f}`, "utf8")))
      .sort();
    expect(importers).toEqual(["sessionModelV2/final/buildFinalPrescriptionV2.ts", "sessionModelV2/index.ts", "sessionModelV2/orchestration/generatePlanV2InMemory.ts"]);
  });

  it("10 — nothing persisted changes: the checks sit beside the prescription; every sport fingerprint is the pre-integration one (7e318ff)", () => {
    for (const s of ALL) {
      expect(JSON.stringify(s.plannedPrescription)).not.toContain("contractChecks");
      expect(Object.keys(s).sort()).toEqual(["contractChecks", "date", "doseTarget", "durationMin", "generatedPlanSessionId", "kind", "plannedPrescription", "rationale", "sportFingerprint", ...(s.loadProfile !== undefined ? ["loadProfile"] : [])].sort());
    }
    expect(Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, p.planSportFingerprint]))).toEqual({
      development: "0d7f49672c5c43f845d86ce5e121d1d59449287dd99dc5a2a94b27f27fb3a410",
      trained: "d7ea10a2570f6f06f146b32dad4f081ac93855815f1ed0153437f8eb6c5b3c58",
      phys: "8d350c3536e236f17fbfbb4e08929abaa7baa128e1128ea7a6944abf381f49c6",
      race: "1c62530ff0556a7518caa07f1148d89141d8a505fa23b8fe1ce450aa98209ec5",
    });
  });
});
