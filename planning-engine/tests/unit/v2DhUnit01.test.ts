/**
 * V2-DH-UNIT-01 (HPM 2026-10-26) — the unit of a DH count end to end: signed attribution only (dhRepetitionUnitCatalogV2,
 * EMPTY in production), builder, plan generation, daily KEEP / MODIFY / REPLACE / manual, validator, contract checks;
 * KEEP checked like every document; the two history aggregates of the block progression characterised.
 *
 * SECTION and FULL_RUN cases use TEST attributions injected below (`fixture.attributions`): they are fixtures, not sports
 * decisions. Every other test runs on the real, empty table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as unitCatalogModule from "../../src/catalog/dhRepetitionUnitCatalogV2.js";
import {
  addDhRepetitionsV2,
  buildDhPrescriptionV2Content,
  buildFinalPrescriptionV2,
  buildSessionModelV2CatalogManifest,
  checkDhSessionPlanV2,
  countEndBlocksV2,
  dhQuotaChecksV2,
  generatePlanV2InMemory,
  readPassMeasureV2,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type DrillItemV2,
  type FinalPrescriptionV2,
  type FinalPrescriptionV2Result,
  type GeneratePlanV2InMemoryResult,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import { SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionDrillCatalogV2.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

type Attribution = { unit: "SECTION" | "FULL_RUN"; provenance: string };
const fixture = vi.hoisted(() => ({ attributions: {} as Record<string, Attribution> }));
// V2-DH-SPORT-GATE-01 — a drill's unit is read through the gate module; this TEST attribution stands for a complete, current sign-off.
vi.mock("../../src/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/sessionModelV2/dhSportGateV2.js")>();
  const { isValidDhRepetitionUnitAttributionV2 } = await import("../../src/catalog/dhRepetitionUnitCatalogV2.js");
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => (isValidDhRepetitionUnitAttributionV2(fixture.attributions[drillId]) ? fixture.attributions[drillId]! : null) };
});

const TEST_PROVENANCE = "TEST fixture V2-DH-UNIT-01 (not a sports decision)";
const attribute = (unit: Attribution["unit"], drillIds: readonly string[] = SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => d.drillId)) => {
  for (const id of drillIds) fixture.attributions[id] = { unit, provenance: TEST_PROVENANCE };
};
beforeEach(() => {
  fixture.attributions = {};
});

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const NO_HISTORY = { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 };
const snapshot = (overrides: Partial<PlanInputSnapshotV2> = {}): PlanInputSnapshotV2 => ({
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
});
const TRAINED = snapshot({ recentHistory: { ...NO_HISTORY, trailingVolumeMinutes: 240 } });
// Advanced braking: the race-speed drill braking_marked_zone_at_speed, whose LIGHT regression is braking_late_entry.
const RACE_SPEED = snapshot({ dhTechnicalTier: "advanced", technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["braking"] }, recentHistory: { ...NO_HISTORY, trailingVolumeMinutes: 240 } });
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-11-02", endDate: "2026-11-29" };
const counter = (prefix: string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
};
const generate = (s: PlanInputSnapshotV2, options: { dhUnit?: "required" } = {}): GeneratePlanV2InMemoryResult => generatePlanV2InMemory({ block: BLOCK, snapshot: s, mintId: counter("a"), ...options });
const plan = (s: PlanInputSnapshotV2, options: { dhUnit?: "required" } = {}): PlanV2InMemory => {
  const r = generate(s, options);
  if (r.status !== "generated") throw new Error(`expected a plan, got ${r.code}`);
  return r.plan;
};
const sessionsOf = (p: PlanV2InMemory) => p.weeks.flatMap((w) => w.sessions);
const drillsOf = (structure: { blocks: readonly { items: readonly unknown[] }[] }) => structure.blocks.flatMap((b) => b.items).filter((i): i is DrillItemV2 => (i as { kind: string }).kind === "drill");
const sessionOf = (p: PlanV2InMemory, kind: string, load?: string) => {
  const s = sessionsOf(p).find((x) => x.kind === kind && (load === undefined || x.loadProfile === load));
  if (!s) throw new Error(`no ${kind} ${load ?? ""}`);
  return s;
};

function daily(
  p: PlanV2InMemory,
  s: PlanSessionV2InMemory,
  snap: PlanInputSnapshotV2,
  decision: "KEEP" | "MODIFY" | "REPLACE",
  finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"],
  extra: Partial<BuildFinalPrescriptionV2Input> & { structure?: unknown } = {}
): BuildFinalPrescriptionV2Input {
  const { structure, ...rest } = extra;
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: p.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: p.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: structure ?? JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(snap), ridingAvailable: true, mintId: counter("b") },
    ...rest,
  };
}

function manual(p: PlanV2InMemory, snap: PlanInputSnapshotV2, kind: string, extra: Partial<BuildFinalPrescriptionV2Input> = {}): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision: "KEEP", finalSession: { kind, loadProfile: "MODERATE" } },
    lineage: { plannedSessionSource: "manual", sourcePlanVersionId: null, sourceGeneratedSessionId: null, currentPlanVersionId: p.planVersionId, currentPlanCoversDate: true, generatedSession: null },
    plannedPrescription: null,
    adaptation: { athlete: toSessionModelV2Input(snap), ridingAvailable: true, mintId: counter("m") },
    ...extra,
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

const withDrillMeasure = (structure: PrescriptionV2, measure: Record<string, unknown>): PrescriptionV2 =>
  ({ ...structure, blocks: structure.blocks.map((b) => ({ ...b, items: b.items.map((i) => (i.kind === "drill" ? { ...i, measure } : i)) })) }) as unknown as PrescriptionV2;
const issueCodes = (value: unknown, stage: "planned" | "final" = "planned") => {
  const r = validatePrescriptionV2(value, { stage });
  return r.ok ? [] : r.issues.map((i) => i.code);
};

describe("V2-DH-UNIT-01 · catalogue: a unit only from a signed definition", () => {
  it("no drill has a signed unit: the real table is empty, every drill reads UNKNOWN", async () => {
    const real = await vi.importActual<typeof unitCatalogModule>("../../src/catalog/dhRepetitionUnitCatalogV2.js");
    expect(real.DH_SPORT_SIGNOFFS_V2).toEqual({});
    const gate = await vi.importActual<typeof import("../../src/sessionModelV2/dhSportGateV2.js")>("../../src/sessionModelV2/dhSportGateV2.js");
    expect(SESSION_DRILL_CATALOG_V2_ENTRIES.filter((d) => gate.dhRepetitionUnitAttributionV2(d.drillId) !== null)).toEqual([]);
    expect(SESSION_DRILL_CATALOG_V2_ENTRIES.every((d) => !("repetitionUnit" in d) && !("unit" in d))).toBe(true);
  });

  it("an attribution needs a stated unit and a non-empty provenance; anything else is not trusted", () => {
    const valid = unitCatalogModule.isValidDhRepetitionUnitAttributionV2;
    expect(valid({ unit: "SECTION", provenance: "HPM 2026-11-01" })).toBe(true);
    expect(valid({ unit: "FULL_RUN", provenance: "HPM 2026-11-01" })).toBe(true);
    for (const bad of [{ unit: "SECTION", provenance: " " }, { unit: "SECTION" }, { unit: "UNKNOWN", provenance: "x" }, { unit: "section", provenance: "x" }, { unit: "SECTION", provenance: "x", note: 1 }, null, "SECTION"]) expect(valid(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("V2-DH-UNIT-01 · A — SECTION stated end to end", () => {
  it("generation (default or required): every DH count states SECTION, with exactly the counts of the unit-less plan; validated, prescribable", () => {
    const legacy = plan(TRAINED);
    attribute("SECTION");
    for (const options of [{}, { dhUnit: "required" as const }]) {
      const p = plan(TRAINED, options);
      const dh = sessionsOf(p).filter((s) => s.kind === "DH_TECHNICAL");
      expect(dh.length).toBeGreaterThan(0);
      for (const s of dh) {
        const [drill] = drillsOf(s.plannedPrescription.structure);
        expect(drill!.measure).toEqual({ type: "pass", count: drill!.measure.count, unit: "SECTION" });
        expect(s.contractChecks.dh.map((q) => [q.unit, q.count.status])).toEqual([["SECTION", "prescribed"]]);
      }
      expect(dh.map((s) => drillsOf(s.plannedPrescription.structure)[0]!.measure.count)).toEqual(sessionsOf(legacy).filter((s) => s.kind === "DH_TECHNICAL").map((s) => drillsOf(s.plannedPrescription.structure)[0]!.measure.count));
    }
  });

  it("daily: KEEP, MODIFY, REPLACE (planned drill or catalogue), manual and the rider's time all keep SECTION; the count only goes down; JSON round trip keeps it", () => {
    attribute("SECTION");
    const p = plan(TRAINED);
    const dh = sessionOf(p, "DH_TECHNICAL", "MODERATE");
    const stored = drillsOf(dh.plannedPrescription.structure)[0]!.measure.count;
    const required = { dhUnit: "required" as const };
    const docs = [
      created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, required))),
      created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "MODIFY", { kind: dh.kind, loadProfile: "LIGHT" }, required))),
      created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "LIGHT" }, required))),
      created(buildFinalPrescriptionV2(daily(p, sessionOf(p, "STRENGTH_LOWER", "MODERATE"), TRAINED, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "MODERATE" }, required))),
      created(buildFinalPrescriptionV2(manual(p, TRAINED, "DH_TECHNICAL", required))),
      created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "MODIFY", { kind: dh.kind, loadProfile: "MODERATE", durationMin: 60 }, { ...required, timeLimitMin: 60 }))),
    ];
    for (const doc of docs) {
      const [drill] = drillsOf(doc.structure);
      expect((drill!.measure as { unit?: string }).unit).toBe("SECTION");
      expect(validatePrescriptionV2(JSON.parse(JSON.stringify(doc.structure)), { stage: "final" })).toMatchObject({ ok: true });
      expect(readPassMeasureV2(JSON.parse(JSON.stringify(drill!.measure)), drill!.drillId).unit).toBe("SECTION");
    }
    expect(drillsOf(docs[0]!.structure)[0]!.measure.count).toBe(stored);
    for (const doc of docs.slice(1, 3)) expect(drillsOf(doc.structure)[0]!.measure.count).toBeLessThanOrEqual(stored);
  });
});

describe("V2-DH-UNIT-01 · A — FULL_RUN only with its conditions", () => {
  it("without the track's descent time: required blocks the count; default keeps the historical unit-less count — never a full-run count", () => {
    attribute("FULL_RUN");
    expect(generate(TRAINED, { dhUnit: "required" })).toMatchObject({ status: "blocked", code: "dh_full_run_needs_track_data" });
    const p = plan(TRAINED);
    for (const s of sessionsOf(p).filter((x) => x.kind === "DH_TECHNICAL")) expect(Object.keys(drillsOf(s.plannedPrescription.structure)[0]!.measure).sort()).toEqual(["count", "type"]);
  });

  it("with the track's descent time (builder input, no source yet): a stated FULL_RUN count, valid and prescribable — its session time still NON VÉRIFIABLE", () => {
    attribute("FULL_RUN");
    const content = buildDhPrescriptionV2Content({
      sessionKind: "DH_TECHNICAL",
      dhSessionOrdinal: 0,
      dhTechnicalTier: "intermediate",
      priorityAreas: ["cornering"],
      terrainAccess: ["flow_trail", "bermed_trail", "technical_trail"],
      focusedRunsCount: 5,
      catalog: buildSessionModelV2CatalogManifest(),
      dhUnit: "required",
      fullRunDescentMin: 4,
    });
    const [drill] = drillsOf(content);
    expect(drill!.measure).toEqual({ type: "pass", count: 5, unit: "FULL_RUN", descentMinutes: 4 });
    const [quota] = dhQuotaChecksV2(content, 90);
    expect([quota!.unit, quota!.count.status, quota!.sessionPlan.verdict]).toEqual(["FULL_RUN", "prescribed", "NON VÉRIFIABLE"]);
    const structure = { ...content, blocks: content.blocks.map((b, i) => ({ ...b, blockId: `b${i}`, items: b.items.map((it, j) => ({ ...it, prescriptionItemId: `i${i}-${j}` })) })) };
    expect(issueCodes(structure)).toEqual([]);
    expect(issueCodes(withDrillMeasure(structure as PrescriptionV2, { type: "pass", count: 5, unit: "FULL_RUN" }))).toEqual(["dh_full_run_without_track_data"]);
    expect(issueCodes(withDrillMeasure(structure as PrescriptionV2, { type: "pass", count: 5, unit: "FULL_RUN", descentMinutes: 0 }))).toEqual(["dh_full_run_without_track_data"]);
  });
});

describe("V2-DH-UNIT-01 · A — UNKNOWN: historical readable, new count refused", () => {
  it("historical (no unit): unchanged by default — validated, read UNKNOWN with its count, KEEP verbatim", () => {
    const p = plan(TRAINED);
    const dh = sessionOf(p, "DH_TECHNICAL", "MODERATE");
    const [drill] = drillsOf(dh.plannedPrescription.structure);
    expect(Object.keys(drill!.measure).sort()).toEqual(["count", "type"]);
    expect(readPassMeasureV2(drill!.measure, drill!.drillId)).toEqual({ unit: "UNKNOWN", count: drill!.measure.count, descentMinutes: null });
    expect(issueCodes(dh.plannedPrescription.structure)).toEqual([]);
    expect(created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }))).structure).toEqual(dh.plannedPrescription.structure);
  });

  it("required: no new count without a signed unit — generation, REPLACE to DH and a manual DH session are refused", () => {
    expect(generate(TRAINED, { dhUnit: "required" })).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown", detail: { drillId: expect.any(String) } });
    const p = plan(TRAINED);
    const required = { dhUnit: "required" as const };
    expect(buildFinalPrescriptionV2(daily(p, sessionOf(p, "STRENGTH_LOWER", "MODERATE"), TRAINED, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "MODERATE" }, required))).toMatchObject({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "dh_repetition_unit_unknown" },
    });
    expect(buildFinalPrescriptionV2(manual(p, TRAINED, "DH_TECHNICAL", required))).toMatchObject({ status: "blocked", detail: { reason: "dh_repetition_unit_unknown" } });
    // The rest of the plan is untouched: a Force session is still created.
    created(buildFinalPrescriptionV2(daily(p, sessionOf(p, "STRENGTH_LOWER", "MODERATE"), TRAINED, "KEEP", { kind: "STRENGTH_LOWER", loadProfile: "MODERATE", durationMin: 60 }, required)));
  });

  it("UNKNOWN is never stored, and no count of an unknown unit is ever added or prescribed", () => {
    const dh = sessionOf(plan(TRAINED), "DH_TECHNICAL");
    const [drill] = drillsOf(dh.plannedPrescription.structure);
    expect(issueCodes(withDrillMeasure(dh.plannedPrescription.structure, { type: "pass", count: drill!.measure.count, unit: "UNKNOWN" }))).toEqual(["invalid_dh_unit"]);
    expect(addDhRepetitionsV2({ unit: "UNKNOWN", count: 5 }, { unit: "SECTION", count: 2 })).toBeNull();
    expect(checkDhSessionPlanV2({ unit: "UNKNOWN", repetitions: null, sessionBudgetMin: 90 }, { briefMin: 5, warmUpMin: 10, rideMinPerRepetition: 2, climbMinPerRepetition: 8, pauseMinPerRepetition: 2, freeDescentsMin: 0, endMin: 5 }).verdict).toBe("NON VÉRIFIABLE");
  });
});

describe("V2-DH-UNIT-01 · B — a unit is never lost, guessed or falsified", () => {
  it("falsified or malformed units are refused by the validator and never trusted by the readers", () => {
    const structure = sessionOf(plan(TRAINED), "DH_TECHNICAL").plannedPrescription.structure;
    const [drill] = drillsOf(structure);
    const count = drill!.measure.count;
    const cases: [Record<string, unknown>, string[]][] = [
      [{ type: "pass", count, unit: "SECTION" }, ["dh_unit_not_attributed"]],
      [{ type: "pass", count, unit: "section" }, ["invalid_dh_unit"]],
      [{ type: "pass", count, unit: "FULL_RUN", descentMinutes: 4 }, ["dh_unit_not_attributed"]],
      [{ type: "pass", count, descentMinutes: 4 }, ["invalid_measure"]],
      [{ type: "pass", count, repetitionUnit: "SECTION" }, ["invalid_measure"]],
    ];
    for (const [measure, codes] of cases) {
      expect(issueCodes(withDrillMeasure(structure, measure)), JSON.stringify(measure)).toEqual(codes);
      expect(readPassMeasureV2(measure as never, drill!.drillId).unit, JSON.stringify(measure)).toBe("UNKNOWN");
    }
    attribute("SECTION");
    expect(issueCodes(withDrillMeasure(structure, { type: "pass", count, unit: "SECTION", descentMinutes: 4 }))).toEqual(["invalid_measure"]);
    expect(issueCodes(withDrillMeasure(structure, { type: "pass", count, unit: "FULL_RUN", descentMinutes: 4 }))).toEqual(["dh_unit_not_attributed"]);
  });

  it("a stored prescription with a falsified unit is never executable nor corrected: KEEP refuses it (contract error)", () => {
    const p = plan(TRAINED);
    const dh = sessionOf(p, "DH_TECHNICAL", "MODERATE");
    const forged = withDrillMeasure(dh.plannedPrescription.structure, { type: "pass", count: 6, unit: "SECTION" });
    expect(() => buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, { structure: forged }))).toThrow(/dh_unit_not_attributed/);
  });

  it("MODIFY keeps the stated unit; a LIGHT regression to a drill without that unit gets no document (never converted)", () => {
    attribute("SECTION", ["braking_marked_zone_at_speed", "braking_late_entry"]);
    const p = plan(RACE_SPEED);
    const dh = sessionsOf(p).find((s) => s.kind === "DH_TECHNICAL" && s.loadProfile === "MODERATE" && drillsOf(s.plannedPrescription.structure)[0]!.drillId === "braking_marked_zone_at_speed");
    if (!dh) throw new Error("no MODERATE race-speed DH session");
    const light = created(buildFinalPrescriptionV2(daily(p, dh, RACE_SPEED, "MODIFY", { kind: dh.kind, loadProfile: "LIGHT" })));
    expect(drillsOf(light.structure)[0]).toMatchObject({ drillId: "braking_late_entry", measure: { type: "pass", unit: "SECTION" } });
    delete fixture.attributions.braking_late_entry;
    expect(buildFinalPrescriptionV2(daily(p, dh, RACE_SPEED, "MODIFY", { kind: dh.kind, loadProfile: "LIGHT" }))).toMatchObject({
      status: "blocked",
      detail: { reason: "dh_repetition_unit_unknown", drillId: "braking_late_entry", regressedFrom: "braking_marked_zone_at_speed", statedUnit: "SECTION" },
    });
  });
});

describe("V2-DH-UNIT-01 · C — the KEEP path", () => {
  it("1 — a historical prescription stays readable and immutable: KEEP copies the frozen document; required mode refuses to execute it and leaves it untouched", () => {
    const p = plan(TRAINED);
    const dh = sessionOf(p, "DH_TECHNICAL", "MODERATE");
    const frozen = deepFreeze(JSON.parse(JSON.stringify(dh.plannedPrescription.structure)));
    const before = JSON.stringify(frozen);
    const keep = created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, { structure: frozen })));
    expect(keep.structure).toEqual(frozen);
    expect(keep.structure).not.toBe(frozen);
    expect(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, { structure: frozen, dhUnit: "required" }))).toMatchObject({
      status: "blocked",
      detail: { reason: "dh_repetition_unit_unknown", drillIds: [drillsOf(frozen)[0]!.drillId] },
    });
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("2 — a completed execution's document is read without writing (deep-frozen): checks and the KEEP copy", () => {
    attribute("SECTION");
    const p = plan(TRAINED);
    const dh = sessionOf(p, "DH_TECHNICAL", "MODERATE");
    const executed = deepFreeze(created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }))).structure);
    const before = JSON.stringify(executed);
    expect(dhQuotaChecksV2(executed, 90).map((q) => q.unit)).toEqual(["SECTION"]);
    expect(validatePrescriptionV2(executed, { stage: "final" })).toMatchObject({ ok: true });
    expect(JSON.stringify(executed)).toBe(before);
  });

  it("3 — a new execution never bypasses the guards through KEEP: a frozen document breaking the RPE semantics gets no document, and is not corrected", () => {
    const p = plan(TRAINED);
    const force = sessionOf(p, "STRENGTH_LOWER", "MODERATE");
    const planned = force.plannedPrescription.structure;
    const warmUp = planned.blocks.findIndex((b) => b.role === "warm_up");
    const broken = { ...planned, blocks: planned.blocks.map((b, i) => (i === warmUp ? { ...b, items: b.items.map((it) => ({ ...it, rpeTarget: { min: 6, max: 7 } })) } : b)) };
    expect(validatePrescriptionV2(broken)).toMatchObject({ ok: true });
    const frozen = deepFreeze(JSON.parse(JSON.stringify(broken)));
    expect(buildFinalPrescriptionV2(daily(p, force, TRAINED, "KEEP", { kind: force.kind, loadProfile: "MODERATE", durationMin: force.durationMin }, { structure: frozen }))).toMatchObject({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "kept_prescription_contract_violation", message: expect.stringMatching(/set_rpe_on_non_work_item/) },
    });
    expect(frozen).toEqual(JSON.parse(JSON.stringify(broken)));
  });

  it("4 — copying never makes an ambiguous count executable: required mode refuses a unit-less copy, accepts a signed SECTION copy", () => {
    const legacyPlan = plan(TRAINED);
    const legacy = sessionOf(legacyPlan, "DH_TECHNICAL", "MODERATE");
    expect(buildFinalPrescriptionV2(daily(legacyPlan, legacy, TRAINED, "KEEP", { kind: legacy.kind, loadProfile: "MODERATE", durationMin: legacy.durationMin }, { dhUnit: "required" })).status).toBe("blocked");
    attribute("SECTION");
    const p = plan(TRAINED, { dhUnit: "required" });
    const dh = sessionOf(p, "DH_TECHNICAL", "MODERATE");
    const keep = created(buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, { dhUnit: "required", dailyMintId: counter("c") })));
    expect([keep.reconciliationAction, (drillsOf(keep.structure)[0]!.measure as { unit?: string }).unit, countEndBlocksV2(keep.structure)]).toEqual(["keep", "SECTION", 1]);
  });
});

describe("V2-DH-UNIT-01 · D — the two history aggregates of the block progression (characterisation, unchanged)", () => {
  const firstWeek = (trailingVolumeMinutes: number) => {
    const p = plan(snapshot({ recentHistory: { ...NO_HISTORY, trailingVolumeMinutes } }));
    const w = p.weeks[0]!;
    const force = w.sessions.find((s) => s.kind === "STRENGTH_LOWER")!;
    const dh = w.sessions.find((s) => s.kind === "DH_TECHNICAL")!;
    return [w.doseSummary.progression?.role, force.loadProfile, force.durationMin, dh.durationMin, drillsOf(dh.plannedPrescription.structure)[0]!.measure.count];
  };

  it("recent volume: 180 min or more skips the introduction week — one step higher at block start (catalogue doses), never beyond", () => {
    expect(firstWeek(179)).toEqual(["introduction", "LIGHT", 45, 75, 5]);
    expect(firstWeek(180)).toEqual(["build", "MODERATE", 60, 90, 6]);
    expect(firstWeek(100_000)).toEqual(firstWeek(180));
  });

  it("missed sessions: 2 or more only hold the first build+ at build — never a rise; only the two aggregates are read", () => {
    const roles = (recentMissedOrReplacedCount: number) => plan(snapshot({ recentHistory: { ...NO_HISTORY, trailingVolumeMinutes: 240, recentMissedOrReplacedCount } })).weeks.map((w) => [w.doseSummary.progression?.role, w.doseSummary.progression?.reasonCodes.includes("recent_missed_sessions_hold")]);
    expect(roles(1)).toEqual([["build", false], ["build_plus", false], ["consolidation", false], ["build", false]]);
    expect(roles(2)).toEqual([["build", false], ["build", true], ["consolidation", false], ["build", false]]);
    const kinds = plan(snapshot({ recentHistory: { recentSessionKinds: ["DH_TECHNICAL", "STRENGTH_LOWER"], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 } }));
    expect(JSON.stringify(kinds)).toBe(JSON.stringify(plan(snapshot())));
  });

  it("the DH unit requirement changes no dose: same counts and durations with or without a stated unit", () => {
    const legacy = plan(TRAINED);
    attribute("SECTION");
    const stated = plan(TRAINED, { dhUnit: "required" });
    const doses = (p: PlanV2InMemory) => sessionsOf(p).map((s) => [s.date, s.kind, s.loadProfile ?? null, s.durationMin, ...drillsOf(s.plannedPrescription.structure).map((d) => d.measure.count)]);
    expect(doses(stated)).toEqual(doses(legacy));
  });
});
