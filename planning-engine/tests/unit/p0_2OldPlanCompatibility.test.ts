/**
 * P0-2 (HPM 2026-10-13) — existing V2 plans after the catalogue change.
 *
 * Before P0-2, an advanced cornering rider with a technical trail received cornering_off_camber. After P0-2,
 * a technical trail alone no longer confirms an off-camber section. Such a stored plan must stay readable AND
 * adaptable: no catalogue version changed (session-model-v2.6, session-drills-v2.0, coaching-text-v1.0 —
 * strictly additive content, ADR P0 REPLACE STALE COPY precedent), so §9 never answers
 * final_prescription_catalog_mismatch, and the stored drill keeps its id, texts and intent.
 *
 * The "old plan" is generated with the off-camber section declared: its DH content is exactly what the base
 * (7fb2da1) produced for a technical-trail rider (same drill, cue, criterion, vigilances, intent, manifest).
 * It is then adapted for the same rider WITHOUT the off-camber section (the rider's real profile).
 */
import { describe, expect, it } from "vitest";
import {
  buildFinalPrescriptionV2,
  buildFinalPrescriptionWithinTodayTimeV2,
  buildSessionModelV2CatalogManifest,
  generatePlanV2InMemory,
  SESSION_MODEL_V2_AGGREGATE_VERSION,
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
import { SESSION_DRILL_CATALOG_V2, SESSION_DRILL_CATALOG_V2_VERSION } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG_VERSION } from "../../src/catalog/coachingTextCatalog.js";
import { INTENT_CATALOG_V2_VERSION } from "../../src/catalog/intentCatalogV2.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const ASTRA_TERRAINS = ["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];

function snapshot(terrainAccess: string[]): PlanInputSnapshotV2 {
  return {
    discipline: "Downhill",
    races: [],
    availability: { windows: ALL_DAY, exceptions: [] },
    equipment: ["dumbbells", "bench"],
    terrainAccess,
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
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
const dhOf = (p: PlanV2InMemory, load: string) => p.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "DH_TECHNICAL" && x.loadProfile === load)!;
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

describe("P0-2 — an existing V2 plan with the off-camber drill, after the catalogue change", () => {
  const old = plan(snapshot([...ASTRA_TERRAINS, "off_camber_section"]));
  const rider = snapshot(ASTRA_TERRAINS); // the rider's real profile: no declared off-camber section
  const moderate = dhOf(old, "MODERATE");
  const offCamber = SESSION_DRILL_CATALOG_V2.cornering_off_camber!;

  it("no catalogue version changed: the stored manifest is the runtime's (session-model-v2.7 since PHYS-01; P0-2 itself changed no version), so §9 never sees a mismatch", () => {
    expect(SESSION_MODEL_V2_AGGREGATE_VERSION).toBe("session-model-v2.7");
    expect([SESSION_DRILL_CATALOG_V2_VERSION, COACHING_TEXT_CATALOG_VERSION, INTENT_CATALOG_V2_VERSION]).toEqual(["session-drills-v2.0", "coaching-text-v1.0", "session-intents-v2.0"]);
    expect(moderate.plannedPrescription.structure.catalog).toEqual(buildSessionModelV2CatalogManifest());
    // The stored content is exactly the base's: same drill, texts, vigilances and intent.
    const [d] = drills(moderate.plannedPrescription.structure);
    expect(d).toMatchObject({ drillId: "cornering_off_camber", cueId: offCamber.cueId, successCriterionId: offCamber.criterionId, vigilanceIds: [...offCamber.vigilanceIds] });
    expect(moderate.plannedPrescription.structure.intentId).toBe("dh_corner_exit_speed");
  });

  it("KEEP: the stored mission is served verbatim (drill, texts, intent), never re-selected", () => {
    const f = created(buildFinalPrescriptionV2(input(old, rider, moderate, "KEEP", { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: moderate.durationMin })));
    expect(drills(f.structure).map((d) => [d.drillId, d.cueId, d.successCriterionId])).toEqual([["cornering_off_camber", offCamber.cueId, offCamber.criterionId]]);
    expect(f.structure.intentId).toBe("dh_corner_exit_speed");
  });

  it("MODIFY to LIGHT: authorised (no catalog mismatch), same drill — it carries no race intensity", () => {
    const r = buildFinalPrescriptionV2(input(old, rider, moderate, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: moderate.durationMin }));
    expect(r.status === "blocked" ? r.code : "created").toBe("created");
    const f = created(r);
    expect(drills(f.structure).map((d) => d.drillId)).toEqual(["cornering_off_camber"]);
  });

  it("A10: shortened to a supported window — authorised, same drill", () => {
    const r = buildFinalPrescriptionWithinTodayTimeV2({ ...input(old, rider, moderate, "KEEP", { kind: "DH_TECHNICAL", loadProfile: "MODERATE", durationMin: moderate.durationMin }), availableMinutes: 60 });
    expect(r.status).toBe("created");
    if (r.status === "created") expect(drills(r.finalPrescription.structure).map((d) => d.drillId)).toEqual(["cornering_off_camber"]);
  });

  it("REPLACE DH → DH_LIGHT derives from the stored DH content: same drill; REPLACE Force → DH builds new content with today's rules: the general alternative (documented difference)", () => {
    const toLight = created(buildFinalPrescriptionV2(input(old, rider, moderate, "REPLACE", { kind: "DH_LIGHT", loadProfile: "LIGHT" })));
    expect(drills(toLight.structure).map((d) => d.drillId)).toEqual(["cornering_off_camber"]);
    const force = old.weeks.flatMap((w) => w.sessions).find((x) => x.kind === "STRENGTH_LOWER")!;
    const fromForce = created(buildFinalPrescriptionV2(input(old, rider, force, "REPLACE", { kind: "DH_TECHNICAL", loadProfile: "MODERATE" })));
    expect(drills(fromForce.structure).map((d) => d.drillId)).toEqual(["cornering_advanced_line_exit"]);
    expect(fromForce.structure.intentId).toBe("dh_corner_line_control");
  });

  it("the stored planned prescription is never rewritten by an adaptation", () => {
    const before = JSON.stringify(moderate.plannedPrescription.structure);
    buildFinalPrescriptionV2(input(old, rider, moderate, "MODIFY", { kind: "DH_TECHNICAL", loadProfile: "LIGHT", durationMin: moderate.durationMin }));
    expect(JSON.stringify(moderate.plannedPrescription.structure)).toBe(before);
  });

  it("a NEW plan for the same rider: the general alternative, with its own intent", () => {
    const fresh = plan(rider);
    const dh = fresh.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === "DH_TECHNICAL");
    expect([...new Set(dh.flatMap((s) => drills(s.plannedPrescription.structure).map((d) => d.drillId)))]).toEqual(["cornering_advanced_line_exit"]);
    expect([...new Set(dh.map((s) => s.plannedPrescription.structure.intentId))]).toEqual(["dh_corner_line_control"]);
  });
});
