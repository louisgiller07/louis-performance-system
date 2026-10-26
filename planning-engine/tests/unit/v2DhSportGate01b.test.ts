/**
 * V2-DH-SPORT-GATE-01B (HPM 2026-10-26) — the lock closes on the content actually presented to the rider.
 * - C binds the displayed drill name: a rename after signing closes the drill (race_execution_split_pace, sheet 14).
 * - The texts every DH session shares (frame instructions, session objectives) are bound by ONE common validation.
 * - A stored document stating a unit must serve exactly the signed content (dh_content_not_signed).
 * - A frozen prescription whose validation became partial, stale or revoked is never served again (KEEP, MODIFY,
 *   REPLACE, manual) and never rewritten; the daily refusal is identifiable (DhSportValidationNotCurrentError) and an
 *   independent day stays served.
 *
 * Sign-offs, the common validation, changed texts and changed names are TEST fixtures routed through the REAL gate
 * (dhSportGateV2): not sports decisions. The production tables stay empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as unitCatalogModule from "../../src/catalog/dhRepetitionUnitCatalogV2.js";
import type { DhSportDecisionV2, DhSportSignoffV2 } from "../../src/catalog/dhRepetitionUnitCatalogV2.js";
import * as gateModule from "../../src/sessionModelV2/dhSportGateV2.js";
import * as textCatalogModule from "../../src/catalog/coachingTextCatalog.js";
import * as drillCatalogModule from "../../src/catalog/sessionDrillCatalogV2.js";
import {
  buildFinalPrescriptionV2,
  DhSportValidationNotCurrentError,
  generatePlanV2InMemory,
  SessionModelV2ContractError,
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
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown, texts: {} as Record<string, string>, names: {} as Record<string, string> }));
vi.mock("../../src/sessionModelV2/dhSportGateV2.js", async (importOriginal) => {
  const real = await importOriginal<typeof gateModule>();
  return { ...real, dhRepetitionUnitAttributionV2: (drillId: string) => real.dhRepetitionUnitAttributionFromSignoffV2(drillId, fixture.signoffs[drillId], fixture.common) };
});
// A text the catalogue serves can be changed after signing (`fixture.texts`: text id → served text).
vi.mock("../../src/catalog/coachingTextCatalog.js", async (importOriginal) => {
  const real = await importOriginal<typeof textCatalogModule>();
  const catalog = new Proxy(real.COACHING_TEXT_CATALOG, {
    get: (target, id) => {
      const entry = Reflect.get(target, id);
      return typeof id === "string" && id in fixture.texts ? { ...entry, text: { "fr-CH": fixture.texts[id] } } : entry;
    },
  });
  return { ...real, COACHING_TEXT_CATALOG: catalog };
});
// A drill's displayed name can be changed after signing (`fixture.names`: drill id → served name). Proxy over a copy: the real table is frozen.
vi.mock("../../src/catalog/sessionDrillCatalogV2.js", async (importOriginal) => {
  const real = await importOriginal<typeof drillCatalogModule>();
  const names = new Proxy({ ...real.SESSION_DRILL_NAMES_V2 }, { get: (target, id) => (typeof id === "string" && id in fixture.names ? fixture.names[id] : Reflect.get(target, id)) });
  return { ...real, SESSION_DRILL_NAMES_V2: names };
});

const TEST_DECISION = "TEST fixture V2-DH-SPORT-GATE-01B (not a sports decision)";
const DECISIONS: readonly DhSportDecisionV2[] = ["unit", "cue", "dose", "safety"];
const ALL_DRILLS = drillCatalogModule.SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => d.drillId);
const SPLIT = "race_execution_split_pace";
const SPLIT_NAME = "Run fractionné à allure course";
const SHEET_14_RENAME = "Section fractionnée à allure course";
// One of the two general DH vigilances (the dossier proposes both on every sheet; cornering_berm_speed serves none).
const VIGILANCE = "vigilance.dh_scout_first";
const gate = (drillId: string, signoff: unknown = fixture.signoffs[drillId]) => gateModule.dhSportGateV2(drillId, signoff, fixture.common);

/** A complete TEST sign-off of the content served now. */
function fullSignoff(drillId: string): DhSportSignoffV2 {
  const served = gateModule.dhServedSportContentV2(drillId);
  if (served === null) throw new Error(`no served content for ${drillId}`);
  return {
    unit: { decision: TEST_DECISION, unit: "SECTION" },
    cue: { decision: TEST_DECISION, drillName: served.drillName, cueText: served.cueText, criterionText: served.criterionText },
    dose: { decision: TEST_DECISION, doseTerms: served.doseTerms },
    safety: { decision: TEST_DECISION, vigilanceTexts: [...served.vigilanceTexts], regressesTo: served.regressesTo, terrains: [...served.terrains] },
  };
}
const signedCommon = () => ({ decision: TEST_DECISION, ...gateModule.dhServedCommonContentV2()! });
const signAll = () => {
  for (const id of ALL_DRILLS) fixture.signoffs[id] = fullSignoff(id);
  fixture.common = signedCommon();
};

beforeEach(() => {
  fixture.signoffs = {};
  fixture.common = null;
  fixture.texts = {};
  fixture.names = {};
});

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const TRAINED_HISTORY = { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 };
const snapshot = (priorityAreas: string[]): PlanInputSnapshotV2 => ({
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "full_dh_track"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas },
  lockedDates: [],
  recentHistory: TRAINED_HISTORY,
  dhTechnicalTier: "intermediate",
});
// Intermediate: cornering → cornering_berm_speed, braking → braking_late_entry, race_execution → race_execution_split_pace.
const TWO = snapshot(["cornering", "braking"]);
const RACE = snapshot(["race_execution"]);
const BLOCK = { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED" as const, primaryFocus: "Test", startDate: "2026-11-02", endDate: "2026-11-29" };
const REQUIRED = { dhUnit: "required" as const };
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
const sessionOf = (p: PlanV2InMemory, kind: string, drillId?: string) => {
  const s = sessionsOf(p).find((x) => x.kind === kind && x.loadProfile === "MODERATE" && (drillId === undefined || drillsOf(x.plannedPrescription.structure)[0]?.drillId === drillId));
  if (!s) throw new Error(`no MODERATE ${kind} session ${drillId ?? ""}`);
  return s;
};

function daily(p: PlanV2InMemory, s: PlanSessionV2InMemory, snap: PlanInputSnapshotV2, decision: "KEEP" | "MODIFY" | "REPLACE", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]): BuildFinalPrescriptionV2Input {
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
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId },
    adaptation: { athlete: toSessionModelV2Input(snap), ridingAvailable: true, mintId: counter("b") },
    dhUnit: "required",
  };
}
const keep = (p: PlanV2InMemory, s: PlanSessionV2InMemory, snap: PlanInputSnapshotV2) => buildFinalPrescriptionV2(daily(p, s, snap, "KEEP", { kind: s.kind, loadProfile: "MODERATE", durationMin: s.durationMin }));
const manual = (p: PlanV2InMemory, snap: PlanInputSnapshotV2): BuildFinalPrescriptionV2Input => ({
  finalPrescriptionId: "final-1",
  decision: { decisionId: "decision-1", decision: "KEEP", finalSession: { kind: "DH_TECHNICAL", loadProfile: "MODERATE" } },
  lineage: { plannedSessionSource: "manual", sourcePlanVersionId: null, sourceGeneratedSessionId: null, currentPlanVersionId: p.planVersionId, currentPlanCoversDate: true, generatedSession: null },
  plannedPrescription: null,
  adaptation: { athlete: toSessionModelV2Input(snap), ridingAvailable: true, mintId: counter("m") },
  dhUnit: "required",
});
function created(r: FinalPrescriptionV2Result): FinalPrescriptionV2 {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}
const issues = (value: unknown) => {
  const r = validatePrescriptionV2(JSON.parse(JSON.stringify(value)), { stage: "planned" });
  return r.ok ? [] : r.issues;
};
const notCurrent = /DhSportValidationNotCurrentError|DH sports validation not current/;

describe("V2-DH-SPORT-GATE-01B · C binds the displayed drill name", () => {
  it("the served name is the name the web shows today; race_execution_split_pace is « Run fractionné à allure course »", () => {
    for (const id of ALL_DRILLS) expect(gateModule.dhServedSportContentV2(id)!.drillName, id).toBe(drillCatalogModule.SESSION_DRILL_NAMES_V2[id]);
    expect(Object.keys(drillCatalogModule.SESSION_DRILL_NAMES_V2).sort()).toEqual([...ALL_DRILLS].sort());
    expect(gateModule.dhServedSportContentV2(SPLIT)!.drillName).toBe(SPLIT_NAME);
  });

  it("race_execution_split_pace renamed after approval: closed (drill_name_differs), no new plan, the plan generated before is no longer served; C re-signed with the new name → served again", () => {
    signAll();
    const p = plan(RACE, REQUIRED);
    const dh = sessionOf(p, "DH_TECHNICAL", SPLIT);
    expect(drillsOf(created(keep(p, dh, RACE)).structure)[0]!.measure).toMatchObject({ type: "pass", unit: "SECTION" });

    fixture.names[SPLIT] = SHEET_14_RENAME;
    expect(gate(SPLIT)).toEqual({ open: false, reasons: ["drill_name_differs"] });
    expect(generate(RACE, REQUIRED)).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown", detail: { drillId: SPLIT } });
    expect(() => keep(p, dh, RACE)).toThrow(notCurrent);

    const signed = fixture.signoffs[SPLIT] as DhSportSignoffV2;
    fixture.signoffs[SPLIT] = { ...signed, cue: { ...signed.cue, drillName: SHEET_14_RENAME } };
    expect(gate(SPLIT)).toMatchObject({ open: true });
    expect(drillsOf(created(keep(p, dh, RACE)).structure)[0]!.measure).toMatchObject({ unit: "SECTION" });
  });

  it("sheet 14: the proposed rename signed while the catalogue still serves « Run fractionné à allure course » → closed, generation refused", () => {
    signAll();
    const signed = fixture.signoffs[SPLIT] as DhSportSignoffV2;
    fixture.signoffs[SPLIT] = { ...signed, cue: { ...signed.cue, drillName: SHEET_14_RENAME } };
    expect(gate(SPLIT)).toEqual({ open: false, reasons: ["drill_name_differs"] });
    expect(generate(RACE, REQUIRED)).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown", detail: { drillId: SPLIT } });
  });
});

describe("V2-DH-SPORT-GATE-01B · the texts every DH session shares: one common validation", () => {
  it("production: absent; what it binds is the 4 frame instructions and the 9 DH session objectives", () => {
    expect(unitCatalogModule.DH_SPORT_COMMON_SIGNOFF_V2).toBeNull();
    const served = gateModule.dhServedCommonContentV2()!;
    expect(served.frame.map((f) => f.role)).toEqual(["brief", "warm_up", "application", "cool_down"]);
    expect(served.frame.map((f) => f.text)).toEqual(["instruction.dh.brief", "instruction.dh.warm_up_easy", "instruction.dh.apply_cue", "instruction.dh.debrief_and_check"].map((id) => textCatalogModule.COACHING_TEXT_CATALOG[id]!.text["fr-CH"]));
    expect(Object.keys(served.objectives).sort()).toEqual([
      "dh_braking_control",
      "dh_corner_exit_speed",
      "dh_corner_line_control",
      "dh_jump_control",
      "dh_line_reading",
      "dh_race_consistency",
      "dh_race_pace",
      "dh_rough_terrain_flow",
      "dh_steep_confidence",
    ]);
    expect(served.objectives.dh_race_pace).toBe("Tenir une allure de course du départ à l'arrivée.");
  });

  it("one common validation opens every drill; absent or malformed, every drill stays closed whatever its four decisions", () => {
    signAll();
    for (const id of ALL_DRILLS) expect(gate(id), id).toMatchObject({ open: true });
    const common = signedCommon();
    const malformed: [string, unknown][] = [
      ["absent", null],
      ["blank reference", { ...common, decision: " " }],
      ["an extra key", { ...common, approvedAll: true }],
      ["a frame line with an extra field", { ...common, frame: [{ ...common.frame[0]!, approved: true }, ...common.frame.slice(1)] }],
      ["an objective that is not a text", { ...common, objectives: { ...common.objectives, dh_race_pace: null } }],
    ];
    for (const [label, value] of malformed) {
      fixture.common = value;
      for (const id of ALL_DRILLS) expect(gate(id), `${label} ${id}`).toEqual({ open: false, reasons: ["common_not_signed"] });
      expect(generate(TWO, REQUIRED), label).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown" });
    }
  });

  it("a common safety instruction changed without validation (the cool-down's bike check removed): every drill closes (frame_differs), no new plan, the plan generated before is no longer served", () => {
    signAll();
    const p = plan(TWO, REQUIRED);
    const dh = sessionOf(p, "DH_TECHNICAL");
    fixture.texts["instruction.dh.debrief_and_check"] = "Termine par une descente facile et note ton ressenti sur l'exercice (facile, moyen, difficile).";
    for (const id of ALL_DRILLS) expect(gate(id), id).toEqual({ open: false, reasons: ["frame_differs"] });
    expect(generate(TWO, REQUIRED)).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown" });
    expect(() => keep(p, dh, TWO)).toThrow(notCurrent);
  });

  it("an objective changed without validation, or the frame's order or a line changed in the signed copy: closed", () => {
    signAll();
    fixture.texts["intent.dh_race_pace"] = "Tenir une allure de course que tu contrôles jusqu'au bout.";
    expect(gate(SPLIT)).toEqual({ open: false, reasons: ["objectives_differ"] });
    expect(gate("cornering_berm_speed")).toEqual({ open: false, reasons: ["objectives_differ"] });
    fixture.texts = {};
    const common = signedCommon();
    const frame = [...common.frame];
    for (const changed of [[frame[1]!, frame[0]!, ...frame.slice(2)], frame.slice(0, 3), [...frame.slice(0, 3), { role: "cool_down", text: `${frame[3]!.text} ` }]]) {
      fixture.common = { ...common, frame: changed };
      expect(gate(SPLIT)).toEqual({ open: false, reasons: ["frame_differs"] });
    }
  });
});

describe("V2-DH-SPORT-GATE-01B · a stored document stating a unit serves exactly the signed content", () => {
  it("an older text, other vigilances, another objective or another frame: dh_content_not_signed at its path; a unit-less document with the same changes is unaffected", () => {
    signAll();
    const structure = sessionOf(plan(TWO, REQUIRED), "DH_TECHNICAL", "cornering_berm_speed").plannedPrescription.structure;
    expect(issues(structure)).toEqual([]);
    const drillPath = "$.blocks[2].items[0]";
    const mutate = (s: PrescriptionV2, change: (doc: PrescriptionV2 & { blocks: { instructionIds: string[]; items: Record<string, unknown>[] }[] }) => void) => {
      const doc = JSON.parse(JSON.stringify(s));
      change(doc);
      return doc;
    };
    const cases: [string, (doc: PrescriptionV2 & { blocks: { instructionIds: string[]; items: Record<string, unknown>[] }[] }) => void, string][] = [
      ["another drill's cue", (d) => (d.blocks[2]!.items[0]!.cueId = "cue.braking_late_entry"), `${drillPath}.cueId`],
      ["another criterion", (d) => (d.blocks[2]!.items[0]!.successCriterionId = "criterion.braking_late_entry"), `${drillPath}.successCriterionId`],
      ["a vigilance added", (d) => (d.blocks[2]!.items[0]!.vigilanceIds = [...(d.blocks[2]!.items[0]!.vigilanceIds as string[]), VIGILANCE]), `${drillPath}.vigilanceIds`],
      ["another DH objective", (d) => ((d as { intentId: string }).intentId = "dh_race_pace"), "$.intentId"],
      ["the brief instruction removed", (d) => (d.blocks[0]!.instructionIds = []), "$.blocks"],
    ];
    expect(drillsOf(structure)[0]!.measure).toMatchObject({ unit: "SECTION" });
    for (const [label, change, path] of cases) expect(issues(mutate(structure, change)), label).toEqual([{ path, code: "dh_content_not_signed" }]);

    fixture.signoffs = {};
    const unitless = sessionOf(plan(TWO), "DH_TECHNICAL", "cornering_berm_speed").plannedPrescription.structure;
    expect(Object.keys(drillsOf(unitless)[0]!.measure).sort()).toEqual(["count", "type"]);
    for (const [label, change] of cases) expect(issues(mutate(unitless, change)).map((i) => i.code), label).not.toContain("dh_content_not_signed");
  });

  it("KEEP of a stored document whose served content is not the signed one: refused, identifiable", () => {
    signAll();
    const p = plan(TWO, REQUIRED);
    const dh = sessionOf(p, "DH_TECHNICAL", "cornering_berm_speed");
    const changed = JSON.parse(JSON.stringify(dh.plannedPrescription.structure));
    changed.blocks[2].items[0].cueId = "cue.braking_late_entry";
    const stored = { ...dh, plannedPrescription: { ...dh.plannedPrescription, structure: changed } };
    expect(() => keep(p, stored, TWO)).toThrow(/dh_content_not_signed/);
    expect(() => keep(p, stored, TWO)).toThrow(DhSportValidationNotCurrentError);
  });
});

describe("V2-DH-SPORT-GATE-01B · a frozen prescription after approval: partial, stale or revoked", () => {
  it("revoked (sign-off removed) and stale (cue changed in the catalogue): refused alike by KEEP, MODIFY LIGHT, REPLACE DH_LIGHT, REPLACE Force → DH and manual; the frozen documents are never rewritten", () => {
    signAll();
    const p = plan(TWO, REQUIRED);
    const dh = sessionOf(p, "DH_TECHNICAL", "cornering_berm_speed");
    const force = sessionOf(p, "STRENGTH_LOWER");
    const frozen = JSON.stringify(sessionsOf(p).map((s) => s.plannedPrescription));
    const paths = {
      keep: () => keep(p, dh, TWO),
      modifyLight: () => buildFinalPrescriptionV2(daily(p, dh, TWO, "MODIFY", { kind: dh.kind, loadProfile: "LIGHT" })),
      replaceDhLight: () => buildFinalPrescriptionV2(daily(p, dh, TWO, "REPLACE", { kind: "DH_LIGHT", loadProfile: "LIGHT" })),
      replaceForceToDh: () => buildFinalPrescriptionV2(daily(p, force, TWO, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "MODERATE" })),
      manual: () => buildFinalPrescriptionV2(manual(p, TWO)),
    };
    for (const [label, run] of Object.entries(paths)) expect(run().status, `signed: ${label}`).toBe("created");

    const signed = { ...fixture.signoffs };
    const scenarios: [string, () => void, readonly string[]][] = [
      ["revoked", () => (fixture.signoffs = {}), ["unit_not_signed", "cue_not_signed", "dose_not_signed", "safety_not_signed"]],
      ["stale", () => (fixture.texts["cue.cornering_berm_speed"] = "Consigne modifiée après la signature."), ["cue_text_differs"]],
    ];
    for (const [label, apply, reasons] of scenarios) {
      fixture.signoffs = { ...signed };
      fixture.texts = {};
      apply();
      // No distinction in the data: both read as « no current validation »; only the gate's reasons say which.
      expect(gate("cornering_berm_speed"), label).toEqual({ open: false, reasons });
      for (const run of [paths.keep, paths.modifyLight, paths.replaceDhLight]) expect(run, label).toThrow(DhSportValidationNotCurrentError);
      if (label === "revoked") {
        for (const run of [paths.replaceForceToDh, paths.manual]) expect(run(), label).toMatchObject({ status: "blocked", detail: { reason: "dh_repetition_unit_unknown" } });
      }
    }
    expect(JSON.stringify(sessionsOf(p).map((s) => s.plannedPrescription))).toBe(frozen);
  });
});

describe("V2-DH-SPORT-GATE-01B · daily run: fail-closed, identifiable, an independent day still served", () => {
  it("braking's drill revoked: its DH day throws DhSportValidationNotCurrentError (a contract error, never REST) naming the prescription and the drill; the cornering DH day and a Force day are served", () => {
    signAll();
    const p = plan(TWO, REQUIRED);
    const braking = sessionOf(p, "DH_TECHNICAL", "braking_late_entry");
    const cornering = sessionOf(p, "DH_TECHNICAL", "cornering_berm_speed");
    const force = sessionOf(p, "STRENGTH_LOWER");
    delete fixture.signoffs.braking_late_entry;

    let error: unknown;
    try {
      keep(p, braking, TWO);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DhSportValidationNotCurrentError);
    expect(error).toBeInstanceOf(SessionModelV2ContractError);
    expect(error).toMatchObject({ name: "DhSportValidationNotCurrentError", plannedPrescriptionId: braking.plannedPrescription.id, drillIds: ["braking_late_entry"] });
    expect((error as Error).message).toMatch(/dh_unit_not_attributed/);

    expect(drillsOf(created(keep(p, cornering, TWO)).structure)[0]).toMatchObject({ drillId: "cornering_berm_speed", measure: { unit: "SECTION" } });
    expect(created(keep(p, force, TWO)).structure.family).toBe("strength");
  });

  it("any other invalid stored document keeps the generic contract error (not mistaken for a sports validation)", () => {
    signAll();
    const p = plan(TWO, REQUIRED);
    const dh = sessionOf(p, "DH_TECHNICAL", "cornering_berm_speed");
    const corrupt = JSON.parse(JSON.stringify(dh.plannedPrescription.structure));
    corrupt.blocks[2].items[0].measure.count = 99;
    const stored = { ...dh, plannedPrescription: { ...dh.plannedPrescription, structure: corrupt } };
    let error: unknown;
    try {
      keep(p, stored, TWO);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessionModelV2ContractError);
    expect(error).not.toBeInstanceOf(DhSportValidationNotCurrentError);
  });
});

describe("V2-DH-SPORT-GATE-01B · V2 OFF behaviour unchanged", () => {
  it("default mode (no unit required): the same unit-less plan with or without the common validation, a renamed drill or a changed frame text", () => {
    const reference = sessionsOf(plan(TWO)).map((s) => s.plannedPrescription.structure);
    fixture.common = signedCommon();
    fixture.names[SPLIT] = SHEET_14_RENAME;
    expect(sessionsOf(plan(TWO)).map((s) => s.plannedPrescription.structure)).toEqual(reference);
    for (const s of sessionsOf(plan(TWO)).filter((x) => x.kind === "DH_TECHNICAL")) expect(Object.keys(drillsOf(s.plannedPrescription.structure)[0]!.measure).sort()).toEqual(["count", "type"]);
  });
});
