import { describe, expect, it } from "vitest";
import {
  buildKeepFinalPrescriptionV2,
  generatePlanV2InMemory,
  sportFingerprint,
  validateKeepFinalPrescriptionV2,
  SessionModelV2ContractError,
  type BuildKeepFinalPrescriptionV2Input,
  type DrillItemV2,
  type FinalPrescriptionV2,
  type PlanInputSnapshotV2,
  type PlanSessionV2InMemory,
  type PlanV2InMemory,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputAvailabilityWindow } from "../../src/types/planInputSnapshot.js";

// UX-11A.5c.1 — pure KEEP final prescription V2 (ADR UX-11A.5c.0). KEEP = copy,
// only with real plan lineage; everything else produces no document.

const ALL_DAY: PlanInputAvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d as PlanInputAvailabilityWindow["dayOfWeek"], startTime: "08:00", endTime: "20:00" }));
const SNAPSHOT: PlanInputSnapshotV2 = {
  discipline: "Downhill",
  races: [],
  availability: { windows: ALL_DAY, exceptions: [] },
  equipment: ["dumbbells", "bench"],
  terrainAccess: ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail"],
  strengthExperienceTier: "intermediate",
  declaredLimitations: [],
  technicalPriorities: { strengths: [], weaknesses: [], priorityAreas: ["cornering", "braking"] },
  lockedDates: [],
  // BUG-V2-2 — a rider already training: the block starts at build (MODERATE Force / DH / endurance), the doses these KEEP cases copy.
  recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 240 },
  dhTechnicalTier: "intermediate",
};

function counter() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

const PLAN: PlanV2InMemory = (() => {
  const r = generatePlanV2InMemory({ block: { sequenceNumber: 1, name: "Plan", mode: "UNSPECIFIED", primaryFocus: "Test", startDate: "2026-10-05", endDate: "2026-10-18" }, snapshot: SNAPSHOT, mintId: counter() });
  if (r.status !== "generated") throw new Error("expected a generated plan");
  return r.plan;
})();

const session = (kind: string): PlanSessionV2InMemory => {
  const s = PLAN.weeks.flatMap((w) => w.sessions).find((x) => x.kind === kind);
  if (!s) throw new Error(`no ${kind} session`);
  return s;
};

/** A KEEP input with full lineage for `s`; overrides tweak one condition at a time. */
function keepInput(s: PlanSessionV2InMemory, overrides: Partial<BuildKeepFinalPrescriptionV2Input> = {}): BuildKeepFinalPrescriptionV2Input {
  return {
    finalPrescriptionId: "final-1",
    decision: { decisionId: "decision-1", decision: "KEEP", finalSession: { kind: s.kind, ...(s.loadProfile ? { loadProfile: s.loadProfile } : {}), durationMin: s.durationMin } },
    lineage: {
      plannedSessionSource: "generated",
      sourcePlanVersionId: PLAN.planVersionId,
      sourceGeneratedSessionId: s.generatedPlanSessionId,
      currentPlanVersionId: PLAN.planVersionId,
      generatedSession: { id: s.generatedPlanSessionId, kind: s.kind, loadProfile: s.loadProfile ?? null, durationMin: s.durationMin },
    },
    // A DB round trip: the stored structure is plain JSON.
    plannedPrescription: { ...s.plannedPrescription, generatedPlanSessionId: s.generatedPlanSessionId, structure: JSON.parse(JSON.stringify(s.plannedPrescription.structure)) },
    ...overrides,
  };
}

function created(input: BuildKeepFinalPrescriptionV2Input): FinalPrescriptionV2 {
  const r = buildKeepFinalPrescriptionV2(input);
  if (r.status !== "created") throw new Error(`expected created, got ${JSON.stringify(r)}`);
  return r.finalPrescription;
}

const itemIds = (p: FinalPrescriptionV2["structure"]) => p.blocks.flatMap((b) => b.items.map((i) => i.prescriptionItemId));

describe("KEEP with lineage — the final prescription is a verbatim copy", () => {
  it.each(["STRENGTH_LOWER", "STRENGTH_UPPER", "DH_TECHNICAL", "AEROBIC_BASE"])("%s: structure deep-equal to the planned one, provenance keep / generated", (kind) => {
    const s = session(kind);
    const final = created(keepInput(s));
    expect(final.structure).toEqual(s.plannedPrescription.structure);
    expect(final).toMatchObject({
      id: "final-1",
      decisionId: "decision-1",
      planVersionId: PLAN.planVersionId,
      plannedPrescriptionId: s.plannedPrescription.id,
      activeSessionOrigin: "generated",
      reconciliationAction: "keep",
      adaptationRuleIds: [],
      schemaVersion: "v2",
      catalogVersion: "session-model-v2.6",
    });
  });

  it("Force keeps templateId, exercises, exact sets, ramp-up", () => {
    const s = session("STRENGTH_LOWER");
    const final = created(keepInput(s));
    expect(final.structure.templateId).toBe(s.plannedPrescription.structure.templateId);
    expect(final.structure.templateId).toBeTruthy();
    expect(JSON.stringify(final.structure)).toContain("rampUp");
  });

  it("DH keeps the drillId and the pass count", () => {
    const s = session("DH_TECHNICAL");
    const drill = (p: FinalPrescriptionV2["structure"]) => p.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill") as DrillItemV2;
    const final = created(keepInput(s));
    expect(drill(final.structure).drillId).toBe(drill(s.plannedPrescription.structure).drillId);
    expect(drill(final.structure).measure).toEqual(drill(s.plannedPrescription.structure).measure);
  });

  it("endurance keeps the protocol and the activity selection", () => {
    const s = session("AEROBIC_BASE");
    const final = created(keepInput(s));
    expect(final.structure.protocolId).toBe("endurance_base_continuous");
    expect(final.structure.activitySelection).toEqual(s.plannedPrescription.structure.activitySelection);
  });

  it("same blockIds and prescriptionItemIds, no derivedFromItemId, identical manifest", () => {
    const s = session("STRENGTH_UPPER");
    const final = created(keepInput(s));
    expect(final.structure.blocks.map((b) => b.blockId)).toEqual(s.plannedPrescription.structure.blocks.map((b) => b.blockId));
    expect(itemIds(final.structure)).toEqual(itemIds(s.plannedPrescription.structure));
    expect(JSON.stringify(final.structure)).not.toContain("derivedFromItemId");
    expect(final.structure.catalog).toEqual(s.plannedPrescription.structure.catalog);
  });

  it("sport fingerprint: final KEEP = planned (decision / lineage metadata are outside the sport content)", () => {
    for (const kind of ["STRENGTH_LOWER", "DH_TECHNICAL", "AEROBIC_BASE"]) {
      const s = session(kind);
      const final = created(keepInput(s));
      expect(sportFingerprint(final.structure), kind).toBe(sportFingerprint(s.plannedPrescription.structure));
    }
  });

  it("the copy is independent of the input (no shared reference)", () => {
    const input = keepInput(session("DH_TECHNICAL"));
    const final = created(input);
    expect(final.structure).not.toBe(input.plannedPrescription!.structure);
  });

  it("a final session without explicit duration is still copiable (nothing to compare)", () => {
    const s = session("STRENGTH_LOWER");
    const input = keepInput(s);
    const { durationMin: _omit, ...withoutDuration } = input.decision.finalSession;
    expect(buildKeepFinalPrescriptionV2({ ...input, decision: { ...input.decision, finalSession: withoutDuration } }).status).toBe("created");
  });
});

describe("no lineage → no document (final_prescription_no_lineage), never an invented session", () => {
  const s = session("DH_TECHNICAL");
  const base = keepInput(s);
  it.each<[string, Partial<BuildKeepFinalPrescriptionV2Input>]>([
    ["no_planned_session", { lineage: null, plannedPrescription: null, decision: { decisionId: "d", decision: "KEEP", finalSession: { kind: "RECOVERY_ACTIVE" } } }],
    ["planned_session_not_generated", { lineage: { ...base.lineage!, plannedSessionSource: "manual" } }],
    ["missing_generated_session_lineage", { lineage: { ...base.lineage!, sourceGeneratedSessionId: null } }],
    ["not_current_plan_version", { lineage: { ...base.lineage!, currentPlanVersionId: "another-version" } }],
    ["generated_session_not_found", { lineage: { ...base.lineage!, generatedSession: null } }],
    ["no_planned_prescription", { plannedPrescription: null }],
    ["planned_prescription_of_another_session", { plannedPrescription: { ...base.plannedPrescription!, generatedPlanSessionId: "other-session" } }],
  ])("%s", (reason, overrides) => {
    expect(buildKeepFinalPrescriptionV2({ ...base, ...overrides })).toEqual({ status: "blocked", code: "final_prescription_no_lineage", detail: { reason } });
  });

  it("KEEP on a fallback RECOVERY_ACTIVE without planned session: blocked, no recovery protocol generated", () => {
    const r = buildKeepFinalPrescriptionV2({ finalPrescriptionId: "f", decision: { decisionId: "d", decision: "KEEP", finalSession: { kind: "RECOVERY_ACTIVE" } }, lineage: null, plannedPrescription: null });
    expect(r.status).toBe("blocked");
    expect(JSON.stringify(r)).not.toMatch(/recovery_active_v1|structure/);
  });
});

describe("a KEEP label hiding a difference is not copiable (final_prescription_adaptation_not_defined)", () => {
  const s = session("AEROBIC_BASE");
  const withFinal = (finalSession: BuildKeepFinalPrescriptionV2Input["decision"]["finalSession"]) => buildKeepFinalPrescriptionV2({ ...keepInput(s), decision: { decisionId: "d", decision: "KEEP", finalSession } });

  it("kind mismatch", () => {
    expect(withFinal({ kind: "AEROBIC_INTERVALS", loadProfile: "MODERATE", durationMin: 45 })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "kind_mismatch", planned: "AEROBIC_BASE", final: "AEROBIC_INTERVALS" },
    });
  });

  it("load mismatch", () => {
    expect(withFinal({ kind: "AEROBIC_BASE", loadProfile: "LIGHT", durationMin: 45 })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "load_profile_mismatch", planned: "MODERATE", final: "LIGHT" },
    });
  });

  it("same kind and load, materially different duration (e.g. a T-X 30 min entry M1 labels KEEP)", () => {
    expect(withFinal({ kind: "AEROBIC_BASE", loadProfile: "MODERATE", durationMin: 30 })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "duration_mismatch", planned: 45, final: 30 },
    });
  });
});

describe("REST, MODIFY, REPLACE — no final document", () => {
  const s = session("STRENGTH_LOWER");

  it("REST → { status: none, reason: rest }, never an empty document", () => {
    expect(buildKeepFinalPrescriptionV2({ ...keepInput(s), decision: { decisionId: "d", decision: "REST", finalSession: { kind: "REST" } } })).toEqual({ status: "none", reason: "rest" });
  });

  it("MODIFY downward → modify_not_supported (no KEEP fallback)", () => {
    expect(buildKeepFinalPrescriptionV2({ ...keepInput(s), decision: { decisionId: "d", decision: "MODIFY", finalSession: { kind: "STRENGTH_LOWER", loadProfile: "LIGHT" } } })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "modify_not_supported" },
    });
  });

  it("MODIFY upward → upward_modify_not_supported", () => {
    expect(buildKeepFinalPrescriptionV2({ ...keepInput(s), decision: { decisionId: "d", decision: "MODIFY", finalSession: { kind: "STRENGTH_LOWER", loadProfile: "HEAVY" } } })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "upward_modify_not_supported" },
    });
  });

  it("REPLACE → replace_not_supported, even towards a kind that has a V2 builder", () => {
    expect(buildKeepFinalPrescriptionV2({ ...keepInput(s), decision: { decisionId: "d", decision: "REPLACE", finalSession: { kind: "STRENGTH_UPPER", loadProfile: "MODERATE" } } })).toEqual({
      status: "blocked",
      code: "final_prescription_adaptation_not_defined",
      detail: { reason: "replace_not_supported" },
    });
  });
});

describe("an untrustworthy planned prescription is refused (contract error, never a block or a fallback)", () => {
  const s = session("DH_TECHNICAL");
  const base = keepInput(s);
  it.each<[string, (p: any) => void]>([
    ["a v1 planned prescription", (p) => (p.schemaVersion = "v1")],
    ["an invalid structure", (p) => (p.structure.blocks[0].blockId = "")],
    ["a structure already carrying derivedFromItemId", (p) => (p.structure.blocks.find((b: any) => b.items.length > 0).items[0].derivedFromItemId = "x")],
    ["a catalog_version differing from the manifest", (p) => (p.catalogVersion = "session-model-v2.4")],
    ["a structure of another kind than its generated session", (p) => (p.structure.sessionKind = "AEROBIC_BASE")],
  ])("%s", (_label, mutate) => {
    const planned = JSON.parse(JSON.stringify(base.plannedPrescription));
    mutate(planned);
    expect(() => buildKeepFinalPrescriptionV2({ ...base, plannedPrescription: planned })).toThrow(SessionModelV2ContractError);
  });
});

describe("UX-11A.5c.3 — planned prescription from another catalogue aggregate", () => {
  const s = session("STRENGTH_LOWER");
  const base = keepInput(s);
  const withStructure = (mutate: (structure: any, record: any) => void) => {
    const planned = JSON.parse(JSON.stringify(base.plannedPrescription));
    mutate(planned.structure, planned);
    return buildKeepFinalPrescriptionV2({ ...base, plannedPrescription: planned });
  };

  it("older aggregate the runtime can no longer validate → final_prescription_catalog_mismatch (expected, no fallback)", () => {
    expect(
      withStructure((st, rec) => {
        st.catalog.aggregate = "session-model-v2.0";
        rec.catalogVersion = "session-model-v2.0";
        st.blocks.find((b: any) => b.role === "main").items[0].exerciseId = "exercise_removed_since_v2_0";
      })
    ).toEqual({ status: "blocked", code: "final_prescription_catalog_mismatch", detail: { plannedAggregate: "session-model-v2.0", runtimeAggregate: "session-model-v2.6" } });
  });

  it("older aggregate still valid for this runtime → KEEP copies it verbatim with its own manifest", () => {
    const r = withStructure((st, rec) => {
      st.catalog.aggregate = "session-model-v2.4";
      rec.catalogVersion = "session-model-v2.4";
    });
    expect(r.status).toBe("created");
    if (r.status === "created") expect(r.finalPrescription.catalogVersion).toBe("session-model-v2.4");
  });

  it("the runtime's own aggregate with an unknown exercise is corruption → contract error", () => {
    expect(() => withStructure((st) => (st.blocks.find((b: any) => b.role === "main").items[0].exerciseId = "unknown_exercise_id"))).toThrow(SessionModelV2ContractError);
  });
});

describe("validateKeepFinalPrescriptionV2 — every invariant is enforced", () => {
  const s = session("STRENGTH_LOWER");
  const planned = { id: s.plannedPrescription.id, structure: s.plannedPrescription.structure };
  const final = created(keepInput(s));

  it("accepts the built KEEP", () => {
    expect(validateKeepFinalPrescriptionV2(final, planned)).toEqual({ ok: true });
  });

  it.each<[string, string, (f: any) => void]>([
    ["action_not_keep", "a non-keep action", (f) => (f.reconciliationAction = "modify")],
    ["planned_prescription_id_mismatch", "a missing planned prescription id", (f) => delete f.plannedPrescriptionId],
    ["keep_has_adaptation_rules", "adaptation rules", (f) => (f.adaptationRuleIds = ["C3.3"])],
    ["catalog_version_not_manifest_aggregate", "a catalog version off the manifest", (f) => (f.catalogVersion = "x")],
    ["derived_from_item_id_on_keep", "a derivedFromItemId", (f) => (f.structure.blocks.find((b: any) => b.items.length > 0).items[0].derivedFromItemId = "p")],
    ["item_ids_differ", "a regenerated item id", (f) => (f.structure.blocks.find((b: any) => b.items.length > 0).items[0].prescriptionItemId = "new")],
    ["block_ids_differ", "a regenerated block id", (f) => (f.structure.blocks[0].blockId = "new")],
    ["sport_fingerprint_differs", "a changed dose", (f) => (f.structure.blocks.find((b: any) => b.role === "main").items[0].sets += 1)],
    ["templateId_differs", "another template", (f) => (f.structure.templateId = "other_template")],
    ["manifest_differs_from_planned", "another manifest", (f) => (f.structure.catalog.strengthDoses = "strength-doses-v9")],
  ])("%s — %s", (issue, _label, mutate) => {
    const tampered = JSON.parse(JSON.stringify(final));
    mutate(tampered);
    const r = validateKeepFinalPrescriptionV2(tampered, planned);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.issues).toContain(issue);
  });
});
