/**
 * V2-DH-SPORT-GATE-01 (HPM 2026-10-26) — the four sports validations U / C / D / S lock every V2 DH count. Only a
 * complete sign-off whose content is the content served gives a drill its unit; a partial or stale sign-off unlocks no
 * quantitative DH prescription on any V2 path: generation, daily KEEP / MODIFY / REPLACE / manual, LIGHT regression,
 * validator, stored-measure reader.
 *
 * Sign-offs below are TEST fixtures (`fixture.signoffs`) routed through the REAL gate (dhSportGateV2): not sports
 * decisions. The production table stays empty.
 */
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as unitCatalogModule from "../../src/catalog/dhRepetitionUnitCatalogV2.js";
import type { DhSportDecisionV2, DhSportSignoffV2 } from "../../src/catalog/dhRepetitionUnitCatalogV2.js";
import * as gateModule from "../../src/sessionModelV2/dhSportGateV2.js";
import * as textCatalogModule from "../../src/catalog/coachingTextCatalog.js";
import {
  buildFinalPrescriptionV2,
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

const fixture = vi.hoisted(() => ({ signoffs: {} as Record<string, unknown>, common: null as unknown, texts: {} as Record<string, string> }));
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

// V2-DH-SPORT-GATE-01B — the common DH validation is a TEST fixture too (signed in beforeEach unless a test says otherwise).
const gate = (drillId: string, signoff: unknown) => gateModule.dhSportGateV2(drillId, signoff, fixture.common);
const DECISIONS: readonly DhSportDecisionV2[] = ["unit", "cue", "dose", "safety"];
const TEST_DECISION = "TEST fixture V2-DH-SPORT-GATE-01 (not a sports decision)";
const ALL_DRILLS = SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => d.drillId);

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
const partialSignoff = (drillId: string, signed: readonly DhSportDecisionV2[]) => Object.fromEntries(Object.entries(fullSignoff(drillId)).filter(([d]) => signed.includes(d as DhSportDecisionV2)));
const sign = (signed: readonly DhSportDecisionV2[], drillIds: readonly string[] = ALL_DRILLS) => {
  for (const id of drillIds) fixture.signoffs[id] = partialSignoff(id, signed);
};
/** Every combination of decisions that is not all four (the empty one included): 15. */
const PARTIALS: readonly (readonly DhSportDecisionV2[])[] = Array.from({ length: 15 }, (_, mask) => DECISIONS.filter((_, i) => (mask >> i) & 1));

beforeEach(() => {
  fixture.signoffs = {};
  fixture.common = { decision: TEST_DECISION, ...gateModule.dhServedCommonContentV2()! };
  fixture.texts = {};
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
const dhSessionOf = (p: PlanV2InMemory, drillId?: string) => {
  const s = sessionsOf(p).find((x) => x.kind === "DH_TECHNICAL" && x.loadProfile === "MODERATE" && (drillId === undefined || drillsOf(x.plannedPrescription.structure)[0]!.drillId === drillId));
  if (!s) throw new Error(`no MODERATE DH session ${drillId ?? ""}`);
  return s;
};
const strengthSessionOf = (p: PlanV2InMemory) => {
  const s = sessionsOf(p).find((x) => x.kind === "STRENGTH_LOWER" && x.loadProfile === "MODERATE");
  if (!s) throw new Error("no MODERATE STRENGTH_LOWER session");
  return s;
};
const dhCounts = (p: PlanV2InMemory) => sessionsOf(p).filter((s) => s.kind === "DH_TECHNICAL").map((s) => drillsOf(s.plannedPrescription.structure)[0]!.measure);

function daily(
  p: PlanV2InMemory,
  s: PlanSessionV2InMemory,
  snap: PlanInputSnapshotV2,
  decision: "KEEP" | "MODIFY" | "REPLACE",
  finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"],
  extra: Partial<BuildFinalPrescriptionV2Input> = {}
): BuildFinalPrescriptionV2Input {
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
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(snap), ridingAvailable: true, mintId: counter("b") },
    ...extra,
  };
}

function manual(p: PlanV2InMemory, snap: PlanInputSnapshotV2, extra: Partial<BuildFinalPrescriptionV2Input> = {}): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision: "KEEP", finalSession: { kind: "DH_TECHNICAL", loadProfile: "MODERATE" } },
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
const issueCodes = (value: PrescriptionV2) => {
  const r = validatePrescriptionV2(JSON.parse(JSON.stringify(value)), { stage: "planned" });
  return r.ok ? [] : r.issues.map((i) => i.code);
};
const REQUIRED = { dhUnit: "required" as const };

describe("V2-DH-SPORT-GATE-01 · production: no drill is signed", () => {
  it("the real sign-off table is empty and frozen; every drill's gate is closed on its four decisions; no drill has a unit", async () => {
    const real = await vi.importActual<typeof gateModule>("../../src/sessionModelV2/dhSportGateV2.js");
    const table = unitCatalogModule.DH_SPORT_SIGNOFFS_V2;
    expect(table).toEqual({});
    expect(Object.isFrozen(table)).toBe(true);
    expect(unitCatalogModule.DH_SPORT_COMMON_SIGNOFF_V2).toBeNull();
    for (const id of ALL_DRILLS) {
      expect(real.dhRepetitionUnitAttributionV2(id), id).toBeNull();
      expect(real.dhSportGateV2(id, table[id], unitCatalogModule.DH_SPORT_COMMON_SIGNOFF_V2), id).toEqual({
        open: false,
        reasons: ["unit_not_signed", "cue_not_signed", "dose_not_signed", "safety_not_signed", "common_not_signed"],
      });
    }
  });

  it("every drill has served content to sign; the dose terms state every value a DH count is drawn from", () => {
    for (const id of ALL_DRILLS) expect(gateModule.dhServedSportContentV2(id), id).not.toBeNull();
    expect(gateModule.dhDoseTermsV2()).toBe(
      "range 4-8; cap 8; introduction LIGHT 75 min 5 +0/cycle; build MODERATE 90 min 6 +1/cycle; build_plus MODERATE 90 min 7 +1/cycle; consolidation LIGHT 60 min 4 +0/cycle; " +
        "race_specific MODERATE 90 min 8 +0/cycle; taper LIGHT 60 min 4 +0/cycle; 90 min max 8; 75 min max 6; 60 min max 5"
    );
    expect(gateModule.dhServedSportContentV2("not_a_drill")).toBeNull();
  });

  it("no V2 path bypasses the gate: only the gate reads the sign-off table, and every reader of a drill's unit imports it from the gate", () => {
    const SRC = fileURLToPath(new URL("../../src", import.meta.url));
    const files = globSync("**/*.ts", { cwd: SRC }).map((f) => f.replace(/\\/g, "/"));
    const using = (pattern: RegExp) => files.filter((f) => pattern.test(readFileSync(`${SRC}/${f}`, "utf8"))).sort();
    const UNIT_READER = /\bdhRepetitionUnitAttributionV2\b/;
    expect(using(/DH_SPORT_SIGNOFFS_V2|DH_SPORT_COMMON_SIGNOFF_V2/)).toEqual(["catalog/dhRepetitionUnitCatalogV2.ts", "sessionModelV2/dhSportGateV2.ts"]);
    expect(using(UNIT_READER)).toEqual([
      "sessionModelV2/builders/dhPrescriptionV2.ts",
      "sessionModelV2/contracts/dhRepetitionUnitV2.ts",
      "sessionModelV2/dhSportGateV2.ts",
      "sessionModelV2/final/buildFinalPrescriptionV2.ts",
      "sessionModelV2/validatePrescriptionV2.ts",
    ]);
    for (const f of using(UNIT_READER).filter((x) => x !== "sessionModelV2/dhSportGateV2.ts")) {
      expect(readFileSync(`${SRC}/${f}`, "utf8"), f).toMatch(/import \{ dhRepetitionUnitAttributionV2 \} from "\.{1,2}\/dhSportGateV2\.js";/);
    }
  });
});

describe("V2-DH-SPORT-GATE-01 · the gate: four separate decisions", () => {

  it("only the four decisions together open it; each of the 15 partial combinations stays closed and names exactly the missing decisions", () => {
    const open = gate("braking_late_entry", fullSignoff("braking_late_entry"));
    expect(open).toEqual({ open: true, attribution: { unit: "SECTION", provenance: `unit: ${TEST_DECISION}; cue: ${TEST_DECISION}; dose: ${TEST_DECISION}; safety: ${TEST_DECISION}; common: ${TEST_DECISION}` } });
    expect(unitCatalogModule.isValidDhRepetitionUnitAttributionV2((open as { attribution: unknown }).attribution)).toBe(true);
    for (const signed of PARTIALS) {
      expect(gate("braking_late_entry", partialSignoff("braking_late_entry", signed)), signed.join("+") || "none").toEqual({
        open: false,
        reasons: DECISIONS.filter((d) => !signed.includes(d)).map((d) => `${d}_not_signed`),
      });
    }
  });

  it("a decision without its reference, or not exactly formed, is not signed; an unknown key or an unknown drill never opens it", () => {
    const full = fullSignoff("cornering_berm_speed");
    const cases: [string, unknown, string[]][] = [
      ["blank unit reference", { ...full, unit: { ...full.unit, decision: " " } }, ["unit_not_signed"]],
      ["missing cue reference", { ...full, cue: { drillName: full.cue.drillName, cueText: full.cue.cueText, criterionText: full.cue.criterionText } }, ["cue_not_signed"]],
      ["cue without the drill name (V2-DH-SPORT-GATE-01 shape)", { ...full, cue: { decision: TEST_DECISION, cueText: full.cue.cueText, criterionText: full.cue.criterionText } }, ["cue_not_signed"]],
      ["dose reference not a string", { ...full, dose: { ...full.dose, decision: true } }, ["dose_not_signed"]],
      ["safety with an extra field", { ...full, safety: { ...full.safety, approved: true } }, ["safety_not_signed"]],
      ["unit UNKNOWN", { ...full, unit: { ...full.unit, unit: "UNKNOWN" } }, ["unit_not_signed"]],
      ["a global approval key", { ...full, approvedAll: true }, ["malformed_signoff"]],
      ["not an object", "SIGNED", ["unit_not_signed", "cue_not_signed", "dose_not_signed", "safety_not_signed"]],
    ];
    for (const [label, signoff, reasons] of cases) expect(gate("cornering_berm_speed", signoff), label).toEqual({ open: false, reasons });
    expect(gate("not_a_drill", full)).toEqual({ open: false, reasons: ["unknown_drill"] });
  });
});

describe("V2-DH-SPORT-GATE-01 · a partial validation unlocks no quantitative DH prescription", () => {
  it("generation (V2 ON, unit required): each of the 15 partial combinations, given to every drill, refuses the plan; all four generate SECTION counts", () => {
    for (const signed of PARTIALS) {
      fixture.signoffs = {};
      sign(signed);
      expect(generate(TRAINED, REQUIRED), signed.join("+") || "none").toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown" });
    }
    fixture.signoffs = {};
    sign(DECISIONS);
    const counts = dhCounts(plan(TRAINED, REQUIRED));
    expect(counts.length).toBeGreaterThan(0);
    for (const m of counts) expect(m).toEqual({ type: "pass", count: m.count, unit: "SECTION" });
  });

  it("daily (unit required): with a unit alone or three decisions of four, REPLACE to DH and a manual DH session are refused; all four create SECTION documents", () => {
    const p = plan(TRAINED);
    const replace = () => buildFinalPrescriptionV2(daily(p, strengthSessionOf(p), TRAINED, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "MODERATE" }, REQUIRED));
    for (const signed of [["unit"], ["unit", "cue", "dose"], ["unit", "cue", "safety"], ["unit", "dose", "safety"], ["cue", "dose", "safety"]] as DhSportDecisionV2[][]) {
      fixture.signoffs = {};
      sign(signed);
      expect(replace(), signed.join("+")).toMatchObject({ status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "dh_repetition_unit_unknown" } });
      expect(buildFinalPrescriptionV2(manual(p, TRAINED, REQUIRED)), signed.join("+")).toMatchObject({ status: "blocked", detail: { reason: "dh_repetition_unit_unknown" } });
    }
    fixture.signoffs = {};
    sign(DECISIONS);
    expect(drillsOf(created(replace()).structure)[0]!.measure).toMatchObject({ unit: "SECTION" });
    expect(drillsOf(created(buildFinalPrescriptionV2(manual(p, TRAINED, REQUIRED))).structure)[0]!.measure).toMatchObject({ unit: "SECTION" });
  });

  it("a stored SECTION prescription stops being served when its sign-off becomes partial: read UNKNOWN, refused by the validator, KEEP refused", () => {
    sign(DECISIONS);
    const p = plan(TRAINED, REQUIRED);
    const dh = dhSessionOf(p);
    const structure = dh.plannedPrescription.structure;
    const [drill] = drillsOf(structure);
    const keep = (extra: Partial<BuildFinalPrescriptionV2Input> = {}) => buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, extra));
    expect(readPassMeasureV2(drill!.measure, drill!.drillId).unit).toBe("SECTION");
    expect(issueCodes(structure)).toEqual([]);
    expect(drillsOf(created(keep(REQUIRED)).structure)[0]!.measure).toEqual(drill!.measure);

    for (const missing of DECISIONS) {
      fixture.signoffs = {};
      sign(DECISIONS.filter((d) => d !== missing));
      expect(readPassMeasureV2(drill!.measure, drill!.drillId), missing).toEqual({ unit: "UNKNOWN", count: drill!.measure.count, descentMinutes: null });
      expect(issueCodes(structure), missing).toEqual(["dh_unit_not_attributed"]);
      expect(() => keep(REQUIRED), missing).toThrow(/dh_unit_not_attributed/);
      expect(() => keep(), missing).toThrow(/dh_unit_not_attributed/);
    }
  });

  it("a LIGHT regression needs its own complete sign-off: a race-speed drill signed in full, its regression with a unit alone → MODIFY LIGHT refused", () => {
    sign(DECISIONS, ["braking_marked_zone_at_speed", "braking_late_entry"]);
    const p = plan(RACE_SPEED);
    const dh = dhSessionOf(p, "braking_marked_zone_at_speed");
    const light = () => buildFinalPrescriptionV2(daily(p, dh, RACE_SPEED, "MODIFY", { kind: dh.kind, loadProfile: "LIGHT" }));
    expect(drillsOf(created(light()).structure)[0]).toMatchObject({ drillId: "braking_late_entry", measure: { type: "pass", unit: "SECTION" } });
    sign(["unit"], ["braking_late_entry"]);
    expect(light()).toMatchObject({ status: "blocked", detail: { reason: "dh_repetition_unit_unknown", drillId: "braking_late_entry", regressedFrom: "braking_marked_zone_at_speed", statedUnit: "SECTION" } });
  });

  it("default mode (V2 OFF behaviour): a partial sign-off changes nothing — the same unit-less plan as with no sign-off at all", () => {
    const unsigned = sessionsOf(plan(TRAINED)).map((s) => s.plannedPrescription.structure);
    for (const signed of [["unit"], ["unit", "cue", "dose"]] as DhSportDecisionV2[][]) {
      fixture.signoffs = {};
      sign(signed);
      expect(sessionsOf(plan(TRAINED)).map((s) => s.plannedPrescription.structure), signed.join("+")).toEqual(unsigned);
    }
    for (const m of dhCounts(plan(TRAINED))) expect(Object.keys(m).sort()).toEqual(["count", "type"]);
  });
});

describe("V2-DH-SPORT-GATE-01 · identity of the signed and the served content", () => {
  const id = "braking_marked_zone_at_speed";
  const full = () => fullSignoff(id);

  it("a sign-off whose content differs from the served content in one point stays closed and names it", () => {
    const f = full();
    const cases: [string, DhSportSignoffV2, string[]][] = [
      ["cue, one character", { ...f, cue: { ...f.cue, cueText: f.cue.cueText.replace(/\.$/, " !") } }, ["cue_text_differs"]],
      ["criterion", { ...f, cue: { ...f.cue, criterionText: `${f.cue.criterionText} ` } }, ["criterion_text_differs"]],
      ["dose: the pre-race cap of 6 (HPM candidate, not served)", { ...f, dose: { ...f.dose, doseTerms: f.dose.doseTerms.replace("race_specific MODERATE 90 min 8", "race_specific MODERATE 90 min 6") } }, ["dose_terms_differ"]],
      ["a vigilance added", { ...f, safety: { ...f.safety, vigilanceTexts: [...f.safety.vigilanceTexts, "Repère la section à vitesse réduite avant le premier passage."] } }, ["vigilances_differ"]],
      ["vigilances missing", { ...f, safety: { ...f.safety, vigilanceTexts: [] } }, ["vigilances_differ"]],
      ["light-week regression", { ...f, safety: { ...f.safety, regressesTo: null } }, ["regression_differs"]],
      ["terrains", { ...f, safety: { ...f.safety, terrains: [...f.safety.terrains, "root_rock_trail"] } }, ["terrains_differ"]],
    ];
    expect(gate(id, f)).toMatchObject({ open: true });
    for (const [label, signoff, reasons] of cases) expect(gate(id, signoff), label).toEqual({ open: false, reasons });
    // Vigilance order is part of the signed content.
    const two = fullSignoff("cornering_advanced_line_exit");
    expect(two.safety.vigilanceTexts).toHaveLength(2);
    expect(gate("cornering_advanced_line_exit", { ...two, safety: { ...two.safety, vigilanceTexts: [...two.safety.vigilanceTexts].reverse() } })).toEqual({ open: false, reasons: ["vigilances_differ"] });
  });

  it("a correction signed but not integrated: the dossier's candidate cue of sheet 3, signed while the catalogue serves the original → closed, generation refused", () => {
    const candidate =
      "Choisis un seul virage relevé et garde le même pendant toute la séance. À chaque passage, règle ta vitesse avant l'entrée, puis entre en appui sur les pieds, pédales à l'horizontale ou pédale extérieure en bas selon le virage, bras et jambes souples, le regard vers la sortie. Charge le virage relevé dès l'entrée et garde cet appui jusqu'à la sortie.";
    sign(DECISIONS);
    const berm = fullSignoff("cornering_berm_speed");
    fixture.signoffs.cornering_berm_speed = { ...berm, cue: { ...berm.cue, cueText: candidate } };
    expect(gate("cornering_berm_speed", fixture.signoffs.cornering_berm_speed)).toEqual({ open: false, reasons: ["cue_text_differs"] });
    expect(generate(snapshot({ technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] }, recentHistory: { ...NO_HISTORY, trailingVolumeMinutes: 240 } }), REQUIRED)).toMatchObject({
      status: "blocked",
      code: "dh_repetition_unit_unknown",
      detail: { drillId: "cornering_berm_speed" },
    });
  });

  it("a served text changed after signing: the plan generated before stops being served, and no new plan is generated", () => {
    sign(DECISIONS);
    const p = plan(TRAINED, REQUIRED);
    const dh = dhSessionOf(p);
    const [drill] = drillsOf(dh.plannedPrescription.structure);
    expect(readPassMeasureV2(drill!.measure, drill!.drillId).unit).toBe("SECTION");
    fixture.texts[`cue.${drill!.drillId}`] = "Texte modifié après la signature.";
    expect(gate(drill!.drillId, fixture.signoffs[drill!.drillId])).toEqual({ open: false, reasons: ["cue_text_differs"] });
    expect(readPassMeasureV2(drill!.measure, drill!.drillId).unit).toBe("UNKNOWN");
    expect(() => buildFinalPrescriptionV2(daily(p, dh, TRAINED, "KEEP", { kind: dh.kind, loadProfile: "MODERATE", durationMin: dh.durationMin }, REQUIRED))).toThrow(/dh_unit_not_attributed/);
    expect(generate(TRAINED, REQUIRED)).toMatchObject({ status: "blocked", code: "dh_repetition_unit_unknown" });
  });
});
