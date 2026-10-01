import { describe, expect, it } from "vitest";
import {
  assignPrescriptionIds,
  buildSessionModelV2CatalogManifest,
  canonicalSportContent,
  PRESCRIPTION_V2_MEASURE_TYPES,
  SESSION_MODEL_V2_AGGREGATE_VERSION,
  SESSION_MODEL_V2_GENERATION_BLOCK_CODES,
  sportFingerprint,
  toSessionModelV2Input,
  validatePrescriptionV2,
  type PlanInputSnapshotV2,
  type PrescriptionV2,
  type PrescriptionV2Content,
  type PrescriptionV2IssueCode,
} from "../../src/sessionModelV2/index.js";
import type { PlanInputSnapshot } from "../../src/types/planInputSnapshot.js";

// UX-11A.5b.2 — Session Model V2 core types, validator and deterministic
// primitives. Fixture doses below are test data only (structure checks),
// never sport content.

const MANIFEST = buildSessionModelV2CatalogManifest();

const STRENGTH: PrescriptionV2Content = {
  schemaVersion: "v2",
  family: "strength",
  sessionKind: "STRENGTH_LOWER",
  intentId: "lower_body_strength_control",
  protocolId: "strength_warm_up_v1",
  catalog: MANIFEST,
  blocks: [
    {
      role: "warm_up",
      focus: "mobility",
      durationMinutes: { min: 3, max: 4 },
      instructionIds: ["instruction.strength_warm_up.mobility"],
      items: [
        {
          kind: "exercise",
          exerciseId: "hip_90_90",
          role: "warm_up",
          sets: 1,
          measure: { type: "duration", minSeconds: 45, maxSeconds: 60, perSide: true },
          cueId: "cue.hip_90_90",
          vigilanceIds: ["vigilance.mobility_no_forced_range"],
        },
      ],
    },
    {
      role: "main",
      instructionIds: [],
      items: [
        {
          kind: "exercise",
          exerciseId: "goblet_squat",
          role: "principal",
          sets: 4,
          measure: { type: "reps", min: 6, max: 8, perSide: false },
          restSeconds: { min: 120, max: 180 },
          rpeTarget: { min: 7, max: 8 },
          cueId: "cue.goblet_squat",
          vigilanceIds: ["vigilance.knee_pain_free_range"],
          rampUp: { instructionId: "instruction.strength_warm_up.main_movement_ramp", sets: { min: 1, max: 2 } },
        },
        {
          kind: "exercise",
          exerciseId: "farmer_carry",
          role: "prevention",
          sets: 3,
          measure: { type: "distance", minMeters: 20, maxMeters: 30 },
          cueId: "cue.farmer_carry",
          vigilanceIds: [],
        },
      ],
    },
  ],
};

const DH: PrescriptionV2Content = {
  schemaVersion: "v2",
  family: "dh_technical",
  sessionKind: "DH_TECHNICAL",
  intentId: "dh_corner_exit_speed",
  catalog: MANIFEST,
  blocks: [
    { role: "brief", instructionIds: ["instruction.dh.brief"], items: [] },
    {
      role: "main",
      instructionIds: [],
      items: [
        {
          kind: "drill",
          drillId: "cornering_flat_turn_precision",
          measure: { type: "pass", count: 6 },
          cueId: "cue.cornering_flat_turn_precision",
          successCriterionId: "criterion.cornering_flat_turn_precision",
          vigilanceIds: [],
        },
      ],
    },
    { role: "application", instructionIds: ["instruction.dh.apply_cue"], items: [] },
    { role: "cool_down", instructionIds: ["instruction.dh.debrief_and_check"], items: [] },
  ],
};

// UX-11A.5b.2.1 — the activity is a session-level modality, not an item; endurance blocks carry no item.
const ENDURANCE: PrescriptionV2Content = {
  schemaVersion: "v2",
  family: "endurance",
  sessionKind: "AEROBIC_BASE",
  intentId: "aerobic_base_lucidity",
  protocolId: "endurance_base_continuous",
  activitySelection: { mode: "restricted", activityIds: ["road_bike", "mtb_rolling", "home_trainer", "running"] },
  catalog: MANIFEST,
  blocks: [
    { role: "warm_up", durationMinutes: { min: 10, max: 10 }, rpeTarget: { min: 2, max: 3 }, instructionIds: ["instruction.endurance.warm_up_easy"], items: [] },
    {
      role: "main",
      durationMinutes: { min: 30, max: 30 },
      rpeTarget: { min: 3, max: 4 },
      talkTestId: "instruction.endurance.talk_test_full_sentences",
      instructionIds: [],
      items: [],
    },
    { role: "cool_down", durationMinutes: { min: 5, max: 5 }, rpeTarget: { min: 2, max: 2 }, instructionIds: ["instruction.endurance.cool_down_easy"], items: [] },
  ],
};

function counter(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const withIds = (content: PrescriptionV2Content, prefix = "id"): PrescriptionV2 => assignPrescriptionIds(content, counter(prefix));

/** Deep, mutable copy of an identified prescription for invalid-case tests. */
function mutable(content: PrescriptionV2Content): any {
  return JSON.parse(JSON.stringify(withIds(content)));
}

function codes(value: unknown, options?: Parameters<typeof validatePrescriptionV2>[1]): PrescriptionV2IssueCode[] {
  const result = validatePrescriptionV2(value, options);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

describe("Prescription V2 — valid documents", () => {
  it.each([
    ["strength (exercise items, rampUp on the principal)", STRENGTH],
    ["DH (drill item, pass measure, no item role)", DH],
    ["endurance (session-level restricted activitySelection, blocks without items)", ENDURANCE],
  ])("%s validates", (_label, content) => {
    const result = validatePrescriptionV2(withIds(content));
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("the measure vocabulary is exactly the recorded-set vocabulary", () => {
    expect([...PRESCRIPTION_V2_MEASURE_TYPES]).toEqual(["reps", "duration", "distance", "pass"]);
  });
});

describe("Prescription V2 — validator invariants", () => {
  it("schemaVersion must be exactly v2", () => {
    for (const v of ["v1", "V2", "v2.0", undefined]) {
      const doc = mutable(STRENGTH);
      doc.schemaVersion = v;
      expect(codes(doc)).toContain("invalid_schema_version");
    }
  });

  it("the catalogue manifest must be complete: every key, each a non-empty version", () => {
    const nullTemplates = mutable(STRENGTH);
    nullTemplates.catalog.templates = null;
    expect(codes(nullTemplates)).toContain("invalid_manifest");
    const noDoses = mutable(STRENGTH);
    delete noDoses.catalog.strengthDoses;
    expect(codes(noDoses)).toContain("invalid_manifest");
    const missing = mutable(STRENGTH);
    delete missing.catalog.texts;
    expect(codes(missing)).toContain("invalid_manifest");
    const emptyAggregate = mutable(STRENGTH);
    emptyAggregate.catalog.aggregate = "";
    expect(codes(emptyAggregate)).toContain("invalid_manifest");
    const extra = mutable(STRENGTH);
    extra.catalog.other = "x";
    expect(codes(extra)).toContain("invalid_manifest");
  });

  it("refuses empty ids, a duplicated blockId and a duplicated prescriptionItemId (across blocks)", () => {
    const empty = mutable(STRENGTH);
    empty.blocks[0].blockId = " ";
    empty.blocks[1].items[0].prescriptionItemId = "";
    expect(codes(empty)).toEqual(expect.arrayContaining(["empty_id"]));
    expect(codes(empty).filter((c) => c === "empty_id")).toHaveLength(2);

    const dupBlock = mutable(STRENGTH);
    dupBlock.blocks[1].blockId = dupBlock.blocks[0].blockId;
    expect(codes(dupBlock)).toEqual(["duplicate_block_id"]);

    const dupItem = mutable(STRENGTH);
    dupItem.blocks[1].items[1].prescriptionItemId = dupItem.blocks[0].items[0].prescriptionItemId;
    expect(codes(dupItem)).toEqual(["duplicate_prescription_item_id"]);
  });

  it("block roles and item kinds are closed vocabularies (no new role such as 'technical')", () => {
    const role = mutable(DH);
    role.blocks[1].role = "technical";
    expect(codes(role)).toEqual(["invalid_block_role"]);
    const kind = mutable(DH);
    kind.blocks[1].items[0].kind = "technical";
    expect(codes(kind)).toEqual(["invalid_item_kind"]);
  });

  it("a drill item carries no item role and no sets", () => {
    const withRole = mutable(DH);
    withRole.blocks[1].items[0].role = "technical";
    expect(codes(withRole)).toEqual(["drill_with_role"]);
    const withSets = mutable(DH);
    withSets.blocks[1].items[0].sets = 6;
    expect(codes(withSets)).toEqual(["invalid_sets"]);
  });

  it.each([
    [3, ["pass_count_out_of_range"]],
    [4, []],
    [6, []],
    [8, []],
    [9, ["pass_count_out_of_range"]],
    [5.5, ["pass_count_out_of_range"]],
  ])("drill pass count %s", (count, expected) => {
    const doc = mutable(DH);
    doc.blocks[1].items[0].measure.count = count;
    expect(codes(doc)).toEqual(expected);
  });

  it("'passes' (or any unknown type) is not a measure type", () => {
    const drill = mutable(DH);
    drill.blocks[1].items[0].measure.type = "passes";
    expect(codes(drill)).toEqual(["invalid_measure_type"]);
    const exercise = mutable(STRENGTH);
    exercise.blocks[1].items[0].measure = { type: "pass", count: 6 };
    expect(codes(exercise)).toEqual(["invalid_measure_type"]);
  });

  it.each([0, -1, 3.5, "4", undefined])("sets must be a strictly positive integer (got %j)", (sets) => {
    const doc = mutable(STRENGTH);
    doc.blocks[1].items[0].sets = sets;
    expect(codes(doc)).toEqual(["invalid_sets"]);
  });

  it("refuses inverted ranges (reps, duration, distance, rest, RPE, block duration) and RPE outside 1–10", () => {
    const reps = mutable(STRENGTH);
    reps.blocks[1].items[0].measure = { type: "reps", min: 8, max: 6, perSide: false };
    expect(codes(reps)).toEqual(["invalid_range"]);
    const duration = mutable(STRENGTH);
    duration.blocks[0].items[0].measure = { type: "duration", minSeconds: 60, maxSeconds: 45, perSide: true };
    expect(codes(duration)).toEqual(["invalid_range"]);
    const distance = mutable(STRENGTH);
    distance.blocks[1].items[1].measure = { type: "distance", minMeters: 30, maxMeters: 20 };
    expect(codes(distance)).toEqual(["invalid_range"]);
    const rest = mutable(STRENGTH);
    rest.blocks[1].items[0].restSeconds = { min: 180, max: 120 };
    expect(codes(rest)).toEqual(["invalid_range"]);
    const rpe = mutable(STRENGTH);
    rpe.blocks[1].items[0].rpeTarget = { min: 8, max: 7 };
    expect(codes(rpe)).toEqual(["invalid_range"]);
    const rpe11 = mutable(STRENGTH);
    rpe11.blocks[1].items[0].rpeTarget = { min: 9, max: 11 };
    expect(codes(rpe11)).toEqual(["invalid_range"]);
    const block = mutable(ENDURANCE);
    block.blocks[0].durationMinutes = { min: 10, max: 5 };
    expect(codes(block)).toEqual(["invalid_range"]);
  });

  it("refuses zero / negative measures", () => {
    const doc = mutable(STRENGTH);
    doc.blocks[1].items[0].measure = { type: "reps", min: 0, max: 8, perSide: false };
    expect(codes(doc)).toEqual(["invalid_measure"]);
  });

  it("activitySelection (session level) is restricted to a non-empty, known, duplicate-free list", () => {
    const empty = mutable(ENDURANCE);
    empty.activitySelection.activityIds = [];
    expect(codes(empty)).toEqual(["empty_activity_selection"]);
    const free = mutable(ENDURANCE);
    free.activitySelection = { mode: "free" };
    expect(codes(free)).toEqual(["invalid_activity_selection"]);
    const unknown = mutable(ENDURANCE);
    unknown.activitySelection.activityIds = ["road_bike", "swimming"];
    expect(codes(unknown)).toEqual(["invalid_activity_selection"]);
    const dup = mutable(ENDURANCE);
    dup.activitySelection.activityIds = ["road_bike", "road_bike"];
    expect(codes(dup)).toEqual(["invalid_activity_selection"]);
  });

  it("activitySelection only exists on an endurance session, never on another family nor on an item; 'activity' is not an item kind", () => {
    const onStrength = mutable(STRENGTH);
    onStrength.activitySelection = { mode: "restricted", activityIds: ["road_bike"] };
    expect(codes(onStrength)).toEqual(["activity_selection_not_allowed"]);
    const onItem = mutable(STRENGTH);
    onItem.blocks[1].items[0].activitySelection = { mode: "restricted", activityIds: ["road_bike"] };
    expect(codes(onItem)).toEqual(["activity_selection_not_allowed"]);
    const activityItem = mutable(ENDURANCE);
    activityItem.blocks[1].items = [{ prescriptionItemId: "x-1", kind: "activity", measure: { type: "duration", minSeconds: 1800, maxSeconds: 1800 } }];
    expect(codes(activityItem)).toEqual(["invalid_item_kind"]);
  });

  it("an endurance session without activitySelection is not rejected by the structural validator (composition belongs to the builders)", () => {
    const doc = mutable(ENDURANCE);
    delete doc.activitySelection;
    expect(codes(doc)).toEqual([]);
  });

  it("rampUp is refused on a drill and on a non-principal exercise; its shape is locked", () => {
    const ramp = { instructionId: "instruction.strength_warm_up.main_movement_ramp", sets: { min: 1, max: 2 } };
    const onDrill = mutable(DH);
    onDrill.blocks[1].items[0].rampUp = ramp;
    expect(codes(onDrill)).toEqual(["ramp_up_not_allowed"]);
    const onSecondary = mutable(STRENGTH);
    onSecondary.blocks[1].items[1].rampUp = ramp;
    expect(codes(onSecondary)).toEqual(["ramp_up_not_allowed"]);
    const sets = mutable(STRENGTH);
    sets.blocks[1].items[0].rampUp.sets = { min: 1, max: 3 };
    expect(codes(sets)).toEqual(["invalid_ramp_up"]);
    const withRpe = mutable(STRENGTH);
    withRpe.blocks[1].items[0].rampUp.rpeTarget = { min: 4, max: 5 };
    expect(codes(withRpe)).toEqual(["invalid_ramp_up"]);
    const withId = mutable(STRENGTH);
    withId.blocks[1].items[0].rampUp.prescriptionItemId = "ramp-1";
    expect(codes(withId)).toEqual(["invalid_ramp_up"]);
  });

  it.each(["loadKg", "load_kg", "percent1RM", "pct_1rm", "ftp", "watts", "heartRateZone", "hrZone"])("refuses a load / intensity prescription field %s, at any depth", (key) => {
    const top = mutable(STRENGTH);
    top[key] = 1;
    expect(codes(top)).toContain("forbidden_load_field");
    const deep = mutable(STRENGTH);
    deep.blocks[1].items[0].measure[key] = 1;
    expect(codes(deep)).toContain("forbidden_load_field");
  });

  it("derivedFromItemId is refused on a planned prescription and accepted on a daily final one (UX-11A.5c)", () => {
    const doc = mutable(STRENGTH);
    doc.blocks[1].items[0].derivedFromItemId = "planned-item-1";
    expect(codes(doc)).toEqual(["derived_from_not_allowed"]);
    expect(codes(doc, { stage: "final" })).toEqual([]);
  });

  it("referential integrity: unknown exercise, drill, intent, protocol or text id; intent of another family", () => {
    const exercise = mutable(STRENGTH);
    exercise.blocks[1].items[0].exerciseId = "unknown_exercise";
    expect(codes(exercise)).toEqual(["unknown_exercise"]);
    const drill = mutable(DH);
    drill.blocks[1].items[0].drillId = "unknown_drill";
    expect(codes(drill)).toEqual(["unknown_drill"]);
    const cue = mutable(DH);
    cue.blocks[1].items[0].cueId = "criterion.cornering_flat_turn_precision";
    expect(codes(cue)).toEqual(["unknown_text"]);
    const intent = mutable(STRENGTH);
    intent.intentId = "dh_corner_exit_speed";
    expect(codes(intent)).toEqual(["intent_family_mismatch"]);
    const protocol = mutable(ENDURANCE);
    protocol.protocolId = "unknown_protocol";
    expect(codes(protocol)).toEqual(["unknown_protocol"]);
  });

  it("not an object", () => {
    expect(codes(null)).toEqual(["not_an_object"]);
    expect(codes([])).toEqual(["not_an_object"]);
  });
});

describe("Catalogue manifest", () => {
  it("is built from the real component versions (UX-11A.5a.4: real templates and strengthDoses, aggregate v2.1)", () => {
    expect(buildSessionModelV2CatalogManifest()).toEqual({
      aggregate: "session-model-v2.1",
      exercises: "session-exercises-v2.0",
      drills: "session-drills-v2.0",
      intents: "session-intents-v2.0",
      protocols: "session-protocols-v2.0",
      texts: "coaching-text-v1.0",
      templates: "strength-templates-v2.0",
      strengthDoses: "strength-doses-v2.0",
    });
    expect(Object.keys(buildSessionModelV2CatalogManifest())).toEqual(["aggregate", "exercises", "drills", "intents", "protocols", "texts", "templates", "strengthDoses"]);
  });

  it("the aggregate version is distinct from every legacy version", () => {
    expect(SESSION_MODEL_V2_AGGREGATE_VERSION).not.toMatch(/^v\d+$/);
  });
});

describe("Ids — assigned after the sport content, by an injected strategy", () => {
  it("assigns a blockId to every block and a prescriptionItemId to every item, never a derivedFromItemId or a rampUp id", () => {
    const p = withIds(STRENGTH);
    expect(p.blocks.map((b) => b.blockId)).toEqual(["id-1", "id-3"]);
    expect(p.blocks.flatMap((b) => b.items.map((i) => i.prescriptionItemId))).toEqual(["id-2", "id-4", "id-5"]);
    expect(JSON.stringify(p)).not.toContain("derivedFromItemId");
    const principal = p.blocks[1]!.items[0]!;
    expect(principal.kind === "exercise" && principal.rampUp).toEqual({ instructionId: "instruction.strength_warm_up.main_movement_ramp", sets: { min: 1, max: 2 } });
  });
});

describe("Sport fingerprint", () => {
  it("is identical for the same sport content with different UUIDs (and with or without daily lineage)", () => {
    const a = withIds(STRENGTH, "a");
    const b = withIds(STRENGTH, "b");
    expect(a).not.toEqual(b);
    expect(sportFingerprint(a)).toBe(sportFingerprint(b));
    expect(sportFingerprint(a)).toBe(sportFingerprint(STRENGTH));
    const final = JSON.parse(JSON.stringify(b));
    final.blocks[1].items[0].derivedFromItemId = "planned-x";
    final.generatedAt = "2026-10-01T08:00:00Z";
    expect(sportFingerprint(final)).toBe(sportFingerprint(a));
  });

  it("does not depend on object key order", () => {
    const reordered = JSON.parse(JSON.stringify(STRENGTH), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v
    );
    expect(canonicalSportContent(reordered)).toBe(canonicalSportContent(STRENGTH));
  });

  const change = (mutate: (doc: any) => void, base: PrescriptionV2Content = STRENGTH) => {
    const doc = JSON.parse(JSON.stringify(base));
    mutate(doc);
    return sportFingerprint(doc);
  };

  it.each<[string, (doc: any) => void, PrescriptionV2Content?]>([
    ["exercise", (d) => (d.blocks[1].items[0].exerciseId = "barbell_back_squat")],
    ["sets", (d) => (d.blocks[1].items[0].sets = 3)],
    ["reps", (d) => (d.blocks[1].items[0].measure.max = 10)],
    ["RPE", (d) => (d.blocks[1].items[0].rpeTarget.max = 9)],
    ["rest", (d) => (d.blocks[1].items[0].restSeconds.min = 90)],
    ["rampUp", (d) => delete d.blocks[1].items[0].rampUp],
    ["block order", (d) => d.blocks.reverse()],
    ["intent", (d) => (d.intentId = "leg_strength_corner_exit")],
    ["catalog version", (d) => (d.catalog.exercises = "session-exercises-v2.1")],
    ["drill", (d) => (d.blocks[1].items[0].drillId = "cornering_berm_speed"), DH],
    ["passes", (d) => (d.blocks[1].items[0].measure.count = 7), DH],
    ["allowed activity list", (d) => d.activitySelection.activityIds.pop(), ENDURANCE],
    ["activity order", (d) => d.activitySelection.activityIds.reverse(), ENDURANCE],
    ["main block duration", (d) => (d.blocks[1].durationMinutes = { min: 45, max: 45 }), ENDURANCE],
  ])("changes when the %s changes", (_label, mutate, base) => {
    const reference = sportFingerprint(base ?? STRENGTH);
    expect(change(mutate, base)).not.toBe(reference);
  });

  it("includes the session context the caller passes (e.g. the date)", () => {
    expect(sportFingerprint({ date: "2026-10-05", prescription: STRENGTH })).not.toBe(sportFingerprint({ date: "2026-10-06", prescription: STRENGTH }));
  });
});

describe("Drill items are canonical (UX-11A.5b.2.1)", () => {
  it("a drill item is identified by drillId only — no exerciseId alias anywhere in the prescription", () => {
    const dh = withIds(DH);
    const drill = dh.blocks[1]!.items[0]!;
    expect(drill).toMatchObject({ kind: "drill", drillId: "cornering_flat_turn_precision" });
    expect(JSON.stringify(dh)).not.toContain("exerciseId");
  });
});

describe("PlanInputSnapshot V2 — types only", () => {
  const V1: PlanInputSnapshot = {
    discipline: "Downhill",
    races: [],
    availability: { windows: [{ dayOfWeek: 6, startTime: "08:00", endTime: "18:00" }], exceptions: [] },
    equipment: ["dumbbells"],
    terrainAccess: ["flow_trail"],
    strengthExperienceTier: "intermediate",
    declaredLimitations: [],
    technicalPriorities: { strengths: ["jumps"], weaknesses: ["braking"], priorityAreas: ["cornering", "braking"] },
    lockedDates: [],
    recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
  };

  it("keeps every v1 field and adds only a nullable dhTechnicalTier", () => {
    const v2: PlanInputSnapshotV2 = { ...V1, dhTechnicalTier: null };
    expect(Object.keys(v2).sort()).toEqual([...Object.keys(V1), "dhTechnicalTier"].sort());
    const withTier: PlanInputSnapshotV2 = { ...V1, dhTechnicalTier: "advanced" };
    expect(withTier.dhTechnicalTier).toBe("advanced");
  });

  it("the narrow Session Model input keeps priorities in declared order and never exposes strengths or weaknesses", () => {
    const input = toSessionModelV2Input({ ...V1, dhTechnicalTier: "beginner" });
    expect(input).toEqual({
      dhTechnicalTier: "beginner",
      priorityAreas: ["cornering", "braking"],
      terrainAccess: ["flow_trail"],
      equipment: ["dumbbells"],
      strengthExperienceTier: "intermediate",
    });
    const otherStrengths = toSessionModelV2Input({ ...V1, dhTechnicalTier: "beginner", technicalPriorities: { ...V1.technicalPriorities, strengths: [], weaknesses: ["jumps"] } });
    expect(otherStrengths).toEqual(input);
    expect(JSON.stringify(input)).not.toMatch(/strengths|weaknesses/);
  });
});

describe("Generation block codes (defined, not wired)", () => {
  it("are exactly the locked codes", () => {
    expect([...SESSION_MODEL_V2_GENERATION_BLOCK_CODES]).toEqual([
      "missing_dh_technical_tier",
      "missing_dh_priority_areas",
      "too_many_dh_priority_areas",
      "duplicate_dh_priority_areas",
      "unavailable_dh_drill_terrain",
      "unsupported_protocol_duration",
      "dh_passes_out_of_range",
      "no_compatible_strength_exercise",
    ]);
  });
});
