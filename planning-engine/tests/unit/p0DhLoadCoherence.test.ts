import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  dhDrillForLoad,
  generatePlanV2InMemory,
  RACE_SPEED_DRILL_IDS_V2,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type BuildFinalPrescriptionV2Input,
  type DrillItemV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import { SESSION_DRILL_CATALOG_V2, SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// P0 adapted-session coherence — a LIGHT DH never carries a race-intensity
// mission (dogfood 2026-10-17: DH léger LIGHT with « run complet en mode course »).

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const TERRAIN = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "root_rock_trail", "full_dh_track", "steep_technical_trail", "bike_park_jump_line"];

function snapshot(priority: string, trailingVolumeMinutes: number): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess: TERRAIN,
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: [priority] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes },
    dhTechnicalTier: "advanced",
  };
}
function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}
function plan(snap: PlanInputSnapshotV2): PlanV2InMemory {
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "P", mode: "UNSPECIFIED", primaryFocus: "T", startDate: "2026-10-05", endDate: "2026-11-15" }, snapshot: snap, mintId: counter("a") });
  if (r.status !== "generated") throw new Error("plan");
  return r.plan;
}
const drills = (st: PrescriptionV2 | { blocks: readonly { items: readonly unknown[] }[] }) => st.blocks.flatMap((b) => b.items).filter((i) => (i as DrillItemV2).kind === "drill") as DrillItemV2[];
const dhOf = (p: PlanV2InMemory, load: string) => {
  const s = p.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "DH_TECHNICAL" && x.loadProfile === load);
  if (!s) throw new Error(`no DH ${load}`);
  return s;
};
function input(p: PlanV2InMemory, snap: PlanInputSnapshotV2, s: PlanSessionV2InMemory, decision: BuildFinalPrescriptionV2Input["decision"]["decision"], finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]): BuildFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "f",
    decision: { decisionId: "d", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: p.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: p.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    adaptation: { athlete: toSessionModelV2Input(snap), ridingAvailable: true, mintId: counter("b") },
  };
}
function created(r: FinalPrescriptionV2Result) {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  expect(validatePrescriptionV2(r.finalPrescription.structure, { stage: "final" })).toMatchObject({ ok: true });
  return r.finalPrescription;
}

const RACE = snapshot("race_execution", 240); // starts at build: MODERATE DH = race_execution_full_run_sim

describe("P0 — the race-intensity drill set is the catalogue's own words", () => {
  it("a drill is race-intensity iff its validated cue or criterion asks for « mode course » / « vitesse course »", () => {
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      const texts = [COACHING_TEXT_CATALOG[d.cueId]!, COACHING_TEXT_CATALOG[d.criterionId]!].map((t) => t.text["fr-CH"]).join(" ");
      expect(RACE_SPEED_DRILL_IDS_V2.has(d.drillId), d.drillId).toBe(/mode course|vitesse course/.test(texts));
    }
  });

  it("dhDrillForLoad: LIGHT follows the catalogue regression to a non-race drill; any other load keeps the drill; ridden on its own or the source drill's terrain, else null", () => {
    const full = SESSION_DRILL_CATALOG_V2["race_execution_full_run_sim"]!;
    expect(dhDrillForLoad(full, "LIGHT", TERRAIN)?.drillId).toBe("race_execution_section_consistency");
    expect(dhDrillForLoad(full, "MODERATE", TERRAIN)?.drillId).toBe("race_execution_full_run_sim");
    expect(dhDrillForLoad(SESSION_DRILL_CATALOG_V2["cornering_berm_speed"]!, "LIGHT", TERRAIN)?.drillId).toBe("cornering_berm_speed");
    expect(dhDrillForLoad(full, "LIGHT", ["full_dh_track"])?.drillId).toBe("race_execution_section_consistency");
    expect(dhDrillForLoad(full, "LIGHT", ["technical_trail"])).toBeNull();
  });

  it("every race drill regresses, at LIGHT, to a drill whose texts carry no race intensity", () => {
    for (const id of RACE_SPEED_DRILL_IDS_V2) {
      const out = dhDrillForLoad(SESSION_DRILL_CATALOG_V2[id]!, "LIGHT", TERRAIN)!;
      expect(RACE_SPEED_DRILL_IDS_V2.has(out.drillId), `${id} → ${out.drillId}`).toBe(false);
      expect(out.skill).toBe(SESSION_DRILL_CATALOG_V2[id]!.skill);
    }
  });
});

describe("P0 — daily adaptations to LIGHT carry a LIGHT mission", () => {
  const p = plan(RACE);
  const moderate = dhOf(p, "MODERATE");

  it("E — DH MODERATE KEEP: the planned race mission is kept verbatim", () => {
    expect(drills(moderate.plannedPrescription.structure).map((d) => d.drillId)).toEqual(["race_execution_full_run_sim"]);
    const f = created(buildFinalPrescriptionV2(input(p, RACE, moderate, "KEEP", { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: moderate.durationMin })));
    expect(drills(f.structure).map((d) => d.drillId)).toEqual(["race_execution_full_run_sim"]);
  });

  it("A / B — DH MODERATE (full run in race mode) → MODIFY LIGHT: the catalogue regression, with ITS cue, criterion and vigilances, 4 passages, lineage kept", () => {
    const f = created(buildFinalPrescriptionV2(input(p, RACE, moderate, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: moderate.durationMin })));
    const [d] = drills(f.structure);
    const expected = SESSION_DRILL_CATALOG_V2["race_execution_section_consistency"]!;
    expect(d).toMatchObject({ drillId: expected.drillId, cueId: expected.cueId, successCriterionId: expected.criterionId, vigilanceIds: [...expected.vigilanceIds], measure: { type: "pass", count: 4 } });
    expect(d!.derivedFromItemId).toBe(drills(moderate.plannedPrescription.structure)[0]!.prescriptionItemId);
    expect(f.structure.blocks.map((b) => b.role)).toEqual(moderate.plannedPrescription.structure.blocks.map((b) => b.role));
  });

  it("C — REPLACE DH → DH_LIGHT LIGHT and REPLACE Force → DH LIGHT: no race mission either", () => {
    const toLight = created(buildFinalPrescriptionV2(input(p, RACE, moderate, "REPLACE", { kind: "DH_LIGHT", loadProfile: "LIGHT" })));
    expect(drills(toLight.structure).map((d) => d.drillId)).toEqual(["race_execution_section_consistency"]);
    const force = p.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "STRENGTH_LOWER")!;
    const fromForce = created(buildFinalPrescriptionV2(input(p, RACE, force, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "LIGHT" })));
    expect(drills(fromForce.structure).every((d) => !RACE_SPEED_DRILL_IDS_V2.has(d.drillId))).toBe(true);
  });

  it("F — A10: a MODERATE DH shortened to a supported window keeps its MODERATE mission; a LIGHT one takes the LIGHT mission", () => {
    const keepLoad = buildFinalPrescriptionWithinTodayTimeV2({ ...input(p, RACE, moderate, "KEEP", { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: moderate.durationMin }), availableMinutes: 60 });
    expect(keepLoad.status).toBe("created");
    if (keepLoad.status === "created") expect(drills(keepLoad.finalPrescription.structure).map((d) => d.drillId)).toEqual(["race_execution_full_run_sim"]);
    const light = buildFinalPrescriptionWithinTodayTimeV2({ ...input(p, RACE, moderate, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: moderate.durationMin }), availableMinutes: 75 });
    expect(light.status).toBe("created");
    if (light.status === "created") expect(drills(light.finalPrescription.structure).map((d) => d.drillId)).toEqual(["race_execution_section_consistency"]);
  });

  it("a planned drill whose terrain is no longer declared and whose regression terrain is not either: the LIGHT adaptation is blocked (never an invented drill)", () => {
    const narrow = { ...RACE, terrainAccess: ["technical_trail"] };
    const r = buildFinalPrescriptionV2(input(p, narrow, moderate, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: 90 }));
    expect(r).toMatchObject({ status: "blocked", code: "final_prescription_adaptation_not_defined", detail: { reason: "no_light_dh_drill" } });
  });
});

// Onboarding terrains are 9 independent toggles (web TERRAIN_OPTIONS, backend assertValidTerrainAccess):
// any non-empty subset is a valid profile.
const ONBOARDING_TERRAINS = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];
const SKILLS = ["braking", "cornering", "line_choice", "steep_terrain", "roots_rocks", "jumps", "race_execution"] as const;
const TIERS = ["beginner", "intermediate", "advanced"] as const;
const LIGHT_DECISIONS = (mod: PlanSessionV2InMemory) =>
  [
    ["MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: mod.durationMin }],
    ["REPLACE", { kind: "DH_LIGHT", loadProfile: "LIGHT" }],
  ] as const;

describe("P0 — no_light_dh_drill is unreachable from a valid onboarding profile", () => {
  it("every (tier, skill, non-empty terrain subset) that can receive its DH has a LIGHT non-race drill of the same skill on a declared terrain", () => {
    let checked = 0;
    for (let mask = 1; mask < 1 << ONBOARDING_TERRAINS.length; mask++) {
      const terrain = ONBOARDING_TERRAINS.filter((_, i) => mask & (1 << i));
      for (const tier of TIERS) {
        for (const skill of SKILLS) {
          const canonical = SESSION_DRILL_CATALOG_V2_ENTRIES.find((d) => d.skill === skill && d.technicalTier === tier)!;
          if (!terrain.includes(canonical.requiredTerrain)) continue; // cannot receive this DH (pre-existing generation block)
          const light = dhDrillForLoad(canonical, "LIGHT", terrain);
          expect(light, `${tier} ${skill} ${terrain.join("+")}`).not.toBeNull();
          expect(RACE_SPEED_DRILL_IDS_V2.has(light!.drillId)).toBe(false);
          expect(light!.skill).toBe(skill);
          expect(terrain.includes(light!.requiredTerrain) || terrain.includes(canonical.requiredTerrain)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("the real Simulation profile (advanced; cornering, line_choice, race_execution; no any_groomed_trail): plan generated, LIGHT weeks without race drill, MODIFY / REPLACE → LIGHT created on every MODERATE DH", () => {
    const sim: PlanInputSnapshotV2 = {
      ...snapshot("race_execution", 0),
      terrainAccess: ["flow_trail", "bermed_trail", "technical_trail", "rock_garden", "full_dh_track"],
      technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "line_choice", "race_execution"] },
    };
    const p = plan(sim);
    const dh = p.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === "DH_TECHNICAL");
    const lightIds = dh.filter((s) => s.loadProfile === "LIGHT").flatMap((s) => drills(s.plannedPrescription.structure).map((d) => d.drillId));
    expect(lightIds.length).toBeGreaterThan(0);
    expect(lightIds.filter((id) => RACE_SPEED_DRILL_IDS_V2.has(id))).toEqual([]);
    const moderate = dh.filter((s) => s.loadProfile === "MODERATE");
    expect(moderate.some((s) => drills(s.plannedPrescription.structure)[0]!.drillId === "race_execution_full_run_sim")).toBe(true);
    for (const mod of moderate) {
      const planned = drills(mod.plannedPrescription.structure)[0]!.drillId;
      for (const [dec, fin] of LIGHT_DECISIONS(mod)) {
        const ids = drills(created(buildFinalPrescriptionV2(input(p, sim, mod, dec, fin))).structure).map((d) => d.drillId);
        expect(ids.filter((id) => RACE_SPEED_DRILL_IDS_V2.has(id)), `${mod.date} ${dec}`).toEqual([]);
        if (planned === "race_execution_full_run_sim") expect(ids, `${mod.date} ${dec}`).toEqual(["race_execution_section_consistency"]);
      }
    }
  });

  it("each race drill on its minimum valid profile (only its own terrain): plan generated, LIGHT weeks and MODIFY / REPLACE → LIGHT carry the regression", () => {
    for (const race of [...RACE_SPEED_DRILL_IDS_V2]) {
      const d = SESSION_DRILL_CATALOG_V2[race]!;
      const snap: PlanInputSnapshotV2 = { ...snapshot(d.skill, 0), terrainAccess: [d.requiredTerrain], dhTechnicalTier: d.technicalTier };
      const p = plan(snap);
      const expected = dhDrillForLoad(d, "LIGHT", snap.terrainAccess)!.drillId;
      const dh = p.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === "DH_TECHNICAL");
      for (const s of dh) expect(drills(s.plannedPrescription.structure)[0]!.drillId, `${race} ${s.date}`).toBe(s.loadProfile === "LIGHT" ? expected : race);
      const mod = dhOf(p, "MODERATE");
      for (const [dec, fin] of LIGHT_DECISIONS(mod)) {
        expect(drills(created(buildFinalPrescriptionV2(input(p, snap, mod, dec, fin))).structure).map((x) => x.drillId), `${race} ${dec}`).toEqual([expected]);
      }
    }
  });
});

describe("P0 — the planner: a LIGHT DH week never prescribes a race mission", () => {
  it("D — introduction / consolidation weeks (LIGHT) take the LIGHT regression; MODERATE weeks keep the race drill; a LIGHT KEEP is verbatim", () => {
    const snap = snapshot("race_execution", 0); // starts with an introduction week (LIGHT)
    const p = plan(snap);
    const dh = p.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === "DH_TECHNICAL");
    for (const s of dh) {
      const ids = drills(s.plannedPrescription.structure).map((d) => d.drillId);
      if (s.loadProfile === "LIGHT") expect(ids.every((id) => !RACE_SPEED_DRILL_IDS_V2.has(id)), `${s.date}`).toBe(true);
      else expect(ids).toEqual(["race_execution_full_run_sim"]);
    }
    const light = dhOf(p, "LIGHT");
    const f = created(buildFinalPrescriptionV2(input(p, snap, light, "KEEP", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: light.durationMin })));
    expect(f.structure).toEqual(light.plannedPrescription.structure);
  });

  it("matrix: every DH skill at the advanced tier — LIGHT outputs (planner, MODIFY, REPLACE) never carry a race drill; MODERATE plans are unchanged", () => {
    for (const skill of ["braking", "cornering", "line_choice", "steep_terrain", "roots_rocks", "jumps", "race_execution"]) {
      const snap = snapshot(skill, 240);
      const p = plan(snap);
      const mod = dhOf(p, "MODERATE");
      for (const [dec, fin] of [
        ["MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: mod.durationMin }],
        ["REPLACE", { kind: "DH_LIGHT", loadProfile: "LIGHT" }],
      ] as const) {
        const r = created(buildFinalPrescriptionV2(input(p, snap, mod, dec, fin)));
        expect(drills(r.structure).every((d) => !RACE_SPEED_DRILL_IDS_V2.has(d.drillId)), `${skill} ${dec}`).toBe(true);
      }
    }
  });
});
