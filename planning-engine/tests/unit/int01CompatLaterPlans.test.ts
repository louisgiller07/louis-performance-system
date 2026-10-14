import { describe, expect, it } from "vitest";
import {
  buildDhPrescriptionV2Content,
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  buildSessionModelV2CatalogManifest,
  canonicalDhDrill,
  generatePlanV2InMemory,
  toSessionModelV2Input,
  validatePrescriptionV2,
  SessionModelV2GenerationBlockedError,
  type BuildFinalPrescriptionV2Input,
  type DrillItemV2,
  type FinalPrescriptionV2Result,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PrescriptionV2,
} from "../../src/sessionModelV2/index.js";
import { DH_SKILLS_V2, DH_TECHNICAL_TIERS_V2, SESSION_DRILL_CATALOG_V2 } from "../../src/catalog/sessionDrillCatalogV2.js";
import { assertValidTerrainAccess } from "../../src/validation/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// INT-01 compatibility release (HPM 2026-10-13, option d). A later release (P0 first generation / P0-2) generates,
// under the same aggregate session-model-v2.6, plans this runtime must keep serving after a rollback: the V2-only
// drill cornering_advanced_line_exit (its own intent) and drills granted on a compatible terrain. This runtime
// reads, adapts and displays them, and never generates them.

const MANIFEST = buildSessionModelV2CatalogManifest();
const DECLARABLE = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track", "off_camber_section"];
const subsets = (values: readonly string[]) => Array.from({ length: 2 ** values.length }, (_, mask) => values.filter((_, i) => mask & (1 << i)));

function selected(skill: string, tier: string, terrainAccess: string[]): string {
  try {
    const content = buildDhPrescriptionV2Content({ sessionKind: "DH_TECHNICAL", dhSessionOrdinal: 0, dhTechnicalTier: tier as never, priorityAreas: [skill], terrainAccess, focusedRunsCount: 6, catalog: MANIFEST });
    return (content.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill") as DrillItemV2).drillId;
  } catch (error) {
    if (error instanceof SessionModelV2GenerationBlockedError) return `blocked:${error.code}`;
    throw error;
  }
}

describe("INT-01 compatibility — generation is the production generation", () => {
  it("every skill × tier × set of declarable terrains: the reference drill when its required terrain is declared, otherwise blocked — never the V2-only drill", () => {
    for (const skill of DH_SKILLS_V2) {
      for (const tier of DH_TECHNICAL_TIERS_V2) {
        const reference = canonicalDhDrill(skill, tier);
        expect(reference.origin, `${skill}/${tier}`).toBe("v1_enriched");
        for (const terrains of subsets(DECLARABLE)) {
          const got = selected(skill, tier, terrains);
          expect(got, `${skill}/${tier}/${terrains.join("+")}`).toBe(terrains.includes(reference.requiredTerrain) ? reference.drillId : "blocked:unavailable_dh_drill_terrain");
        }
      }
    }
  });

  it("a profile holding « Virages en dévers » (off_camber_section) is a valid snapshot; it changes no selection", () => {
    expect(() => assertValidTerrainAccess(["technical_trail", "off_camber_section"])).not.toThrow();
    expect(selected("cornering", "advanced", ["technical_trail", "off_camber_section"])).toBe("cornering_off_camber");
    expect(selected("cornering", "advanced", ["off_camber_section"])).toBe("blocked:unavailable_dh_drill_terrain");
  });
});

// --- Stored plans of the later release -------------------------------------------------------------------------

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
function snapshotFor(terrainAccess: string[], tier: "intermediate" | "advanced", priorityAreas: string[]): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess,
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
    dhTechnicalTier: tier,
  };
}
function counter(prefix: string) {
  let n = 0;
  return () => `00000000-0000-4000-8000-${prefix}${String(++n).padStart(12 - prefix.length, "0")}`;
}
function dhSessionOf(snapshot: PlanInputSnapshotV2): PlanSessionV2InMemory {
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" }, snapshot, mintId: counter("a") });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  const s = r.plan.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "DH_TECHNICAL");
  if (!s) throw new Error("no DH session");
  return { ...s, planVersionId: r.plan.planVersionId } as PlanSessionV2InMemory & { planVersionId: string };
}

/** The stored planned prescription of the later release: the same session, its main drill being `drillId` (with that drill's texts). */
function laterPlanned(s: PlanSessionV2InMemory, drillId: string, intentId: string): PrescriptionV2 {
  const structure = JSON.parse(JSON.stringify(s.plannedPrescription.structure)) as PrescriptionV2;
  const entry = SESSION_DRILL_CATALOG_V2[drillId]!;
  structure.intentId = intentId;
  for (const block of structure.blocks) {
    for (const item of block.items) {
      if (item.kind !== "drill") continue;
      Object.assign(item, { drillId, cueId: entry.cueId, successCriterionId: entry.criterionId, vigilanceIds: [...entry.vigilanceIds] });
    }
  }
  expect(validatePrescriptionV2(structure, { stage: "planned" })).toMatchObject({ ok: true });
  return structure;
}

function input(s: PlanSessionV2InMemory & { planVersionId?: string }, structure: PrescriptionV2, snapshot: PlanInputSnapshotV2, decision: "KEEP" | "MODIFY", finalSession: BuildFinalPrescriptionV2Input["decision"]["finalSession"]): BuildFinalPrescriptionV2Input {
  const planVersionId = s.planVersionId!;
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision, finalSession },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure },
    adaptation: { athlete: toSessionModelV2Input(snapshot), ridingAvailable: true, mintId: counter("b") },
  };
}
const createdDrill = (r: FinalPrescriptionV2Result) => {
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return { drill: r.finalPrescription.structure.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill") as DrillItemV2, final: r.finalPrescription };
};

describe("INT-01 compatibility — a stored plan holding the V2-only drill (rider: advanced cornering, technical trail + full DH track)", () => {
  const snapshot = snapshotFor(["technical_trail", "full_dh_track"], "advanced", ["cornering"]);
  const s = dhSessionOf(snapshot);
  const planned = laterPlanned(s, "cornering_advanced_line_exit", "dh_corner_line_control");

  it("KEEP: created, verbatim (drill, texts, intent)", () => {
    const { drill, final } = createdDrill(buildFinalPrescriptionV2(input(s, planned, snapshot, "KEEP", { kind: s.kind, loadProfile: s.loadProfile!, durationMin: s.durationMin })));
    expect(final.reconciliationAction).toBe("keep");
    expect(final.structure).toEqual(planned);
    expect(drill.drillId).toBe("cornering_advanced_line_exit");
  });

  it("MODIFY LIGHT: created, the same drill with fewer passes (it carries no race intensity)", () => {
    const { drill, final } = createdDrill(buildFinalPrescriptionV2(input(s, planned, snapshot, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" })));
    expect(final.reconciliationAction).toBe("modify");
    expect(drill.drillId).toBe("cornering_advanced_line_exit");
    expect(final.structure.intentId).toBe("dh_corner_line_control");
  });

  it("A10 — 60 minutes today: created, the same drill in a shorter window", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(s, planned, snapshot, "MODIFY", { kind: s.kind, loadProfile: s.loadProfile!, durationMin: 60 }), timeLimitMin: 60, availableMinutes: 60 });
    expect(createdDrill(r).drill.drillId).toBe("cornering_advanced_line_exit");
  });
});

describe("INT-01 compatibility — a stored race-intensity drill granted on a compatible terrain (rider: advanced braking, full DH track only)", () => {
  const snapshot = snapshotFor(["full_dh_track"], "advanced", ["braking"]);
  // This runtime would not generate it for that rider (technical trail required): built for a technical trail, stored as the later release would.
  const s = dhSessionOf({ ...snapshot, terrainAccess: ["technical_trail", "full_dh_track"] });
  const planned = laterPlanned(s, "braking_marked_zone_at_speed", "dh_braking_control");

  it("MODIFY LIGHT: the catalogue regression on its compatible terrain (braking_late_entry), never blocked", () => {
    const { drill } = createdDrill(buildFinalPrescriptionV2(input(s, planned, snapshot, "MODIFY", { kind: s.kind, loadProfile: "LIGHT" })));
    expect(drill.drillId).toBe("braking_late_entry");
    expect(drill.cueId).toBe("cue.braking_late_entry");
  });
});
