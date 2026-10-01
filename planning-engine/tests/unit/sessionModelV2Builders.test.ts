import { describe, expect, it } from "vitest";
import {
  assignPrescriptionIds,
  buildAerobicBasePrescriptionV2Content,
  buildDhPrescriptionV2Content,
  buildSessionModelV2CatalogManifest,
  canonicalDhDrill,
  deriveDhSessionOrdinals,
  sportFingerprint,
  toSessionModelV2Input,
  validatePrescriptionV2,
  SessionModelV2ContractError,
  SessionModelV2GenerationBlockedError,
  type DhPrescriptionV2Input,
  type PrescriptionV2Content,
  type SessionModelV2GenerationBlockCode,
  type PlanInputSnapshotV2,
} from "../../src/sessionModelV2/index.js";
import { DH_SKILLS_V2, DH_TECHNICAL_TIERS_V2, SESSION_DRILL_CATALOG_V2_ENTRIES } from "../../src/catalog/sessionDrillCatalogV2.js";
import { DH_SESSION_FRAME_V2 } from "../../src/catalog/sessionFrameV2.js";
import { PROTOCOL_CATALOG_V2 } from "../../src/catalog/protocolCatalogV2.js";
import { DH_SKILL_TO_INTENT_V2 } from "../../src/catalog/intentCatalogV2.js";

// UX-11A.5b.3 — pure DH and AEROBIC_BASE builders. Content only (no ids);
// tests assign deterministic ids, then validate the identified prescription.

const MANIFEST = buildSessionModelV2CatalogManifest();
const ALL_TERRAIN = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

function assertValid(content: PrescriptionV2Content) {
  const result = validatePrescriptionV2(assignPrescriptionIds(content, counter()));
  expect(result.ok ? [] : result.issues).toEqual([]);
}

function blockedCode(fn: () => unknown): SessionModelV2GenerationBlockCode | null {
  try {
    fn();
  } catch (error) {
    if (error instanceof SessionModelV2GenerationBlockedError) return error.code;
    throw error;
  }
  return null;
}

const DH_INPUT: DhPrescriptionV2Input = {
  sessionKind: "DH_TECHNICAL",
  dhSessionOrdinal: 0,
  dhTechnicalTier: "intermediate",
  priorityAreas: ["cornering", "braking", "jumps"],
  terrainAccess: ALL_TERRAIN,
  focusedRunsCount: 6,
  catalog: MANIFEST,
};

const drillOf = (content: PrescriptionV2Content) => content.blocks.flatMap((b) => b.items).find((i) => i.kind === "drill");

describe("DH catalogue invariant — exactly one drill per (skill, tier)", () => {
  it("covers the 7 skills × 3 tiers with exactly one drill each (21 drills); the selection is never 'the first compatible'", () => {
    expect(SESSION_DRILL_CATALOG_V2_ENTRIES).toHaveLength(21);
    for (const skill of DH_SKILLS_V2) {
      for (const tier of DH_TECHNICAL_TIERS_V2) {
        expect(SESSION_DRILL_CATALOG_V2_ENTRIES.filter((d) => d.skill === skill && d.technicalTier === tier), `${skill}/${tier}`).toHaveLength(1);
        expect(canonicalDhDrill(skill, tier).skill).toBe(skill);
      }
    }
  });
});

describe("DH builder — output", () => {
  it("follows the DH frame: brief, warm_up, main (the single drill), application, cool_down; validated once identified", () => {
    const content = buildDhPrescriptionV2Content(DH_INPUT);
    expect(content).toEqual({
      schemaVersion: "v2",
      family: "dh_technical",
      sessionKind: "DH_TECHNICAL",
      intentId: "dh_corner_exit_speed",
      catalog: MANIFEST,
      blocks: [
        { role: "brief", instructionIds: ["instruction.dh.brief"], items: [] },
        { role: "warm_up", instructionIds: ["instruction.dh.warm_up_easy"], items: [] },
        {
          role: "main",
          instructionIds: [],
          items: [
            {
              kind: "drill",
              drillId: "cornering_berm_speed",
              measure: { type: "pass", count: 6 },
              cueId: "cue.cornering_berm_speed",
              successCriterionId: "criterion.cornering_berm_speed",
              vigilanceIds: [],
            },
          ],
        },
        { role: "application", instructionIds: ["instruction.dh.apply_cue"], items: [] },
        { role: "cool_down", instructionIds: ["instruction.dh.debrief_and_check"], items: [] },
      ],
    });
    expect(content.blocks.map((b) => b.role)).toEqual(DH_SESSION_FRAME_V2.map((f) => f.role));
    assertValid(content);
  });

  it("only the main block carries a number of passages; no total of runs anywhere; no id in the content", () => {
    const content = buildDhPrescriptionV2Content(DH_INPUT);
    for (const block of content.blocks) {
      if (block.role === "main") expect(block.items).toHaveLength(1);
      else expect(block.items).toEqual([]);
    }
    expect(JSON.stringify(content)).not.toMatch(/"count"[^}]*}[^\]]*"count"/);
    expect(JSON.stringify(content)).not.toMatch(/prescriptionItemId|blockId|exerciseId|runs/);
  });

  it("intent comes only from DH_SKILL_TO_INTENT_V2 for the rotated skill", () => {
    for (const skill of DH_SKILLS_V2) {
      const content = buildDhPrescriptionV2Content({ ...DH_INPUT, priorityAreas: [skill], terrainAccess: ALL_TERRAIN });
      expect(content.intentId).toBe(DH_SKILL_TO_INTENT_V2[skill]);
    }
  });
});

describe("DH builder — rotation and selection", () => {
  it("ordinal 0 / 1 / 2 / 3 with three priorities → A / B / C / A", () => {
    const skills = [0, 1, 2, 3].map((ordinal) => buildDhPrescriptionV2Content({ ...DH_INPUT, dhSessionOrdinal: ordinal }).intentId);
    expect(skills).toEqual(["dh_corner_exit_speed", "dh_braking_control", "dh_jump_control", "dh_corner_exit_speed"]);
  });

  it("the drill follows the declared tier", () => {
    const drills = DH_TECHNICAL_TIERS_V2.map((tier) => drillOf(buildDhPrescriptionV2Content({ ...DH_INPUT, dhTechnicalTier: tier })));
    expect(drills.map((d) => d?.kind === "drill" && d.drillId)).toEqual(["cornering_flat_turn_precision", "cornering_berm_speed", "cornering_off_camber"]);
  });

  it("strengths and weaknesses never reach the builder: changing them changes nothing", () => {
    const snapshot = (strengths: string[], weaknesses: string[]): PlanInputSnapshotV2 => ({
      discipline: "Downhill",
      races: [],
      availability: { windows: [{ dayOfWeek: 6, startTime: "08:00", endTime: "18:00" }], exceptions: [] },
      equipment: [],
      terrainAccess: ALL_TERRAIN,
      strengthExperienceTier: "advanced",
      competitionLevel: "World Cup",
      declaredLimitations: [],
      technicalPriorities: { strengths, weaknesses, priorityAreas: ["cornering", "braking"] },
      lockedDates: [],
      recentHistory: { recentSessionKinds: [], recentMissedOrReplacedCount: 0, trailingVolumeMinutes: 0 },
      dhTechnicalTier: "beginner",
    });
    const build = (s: PlanInputSnapshotV2) => {
      const v = toSessionModelV2Input(s);
      return buildDhPrescriptionV2Content({ sessionKind: "DH_TECHNICAL", dhSessionOrdinal: 1, dhTechnicalTier: v.dhTechnicalTier, priorityAreas: v.priorityAreas, terrainAccess: v.terrainAccess, focusedRunsCount: 6, catalog: MANIFEST });
    };
    expect(build(snapshot(["jumps"], ["braking"]))).toEqual(build(snapshot([], ["cornering", "jumps"])));
  });

  it("same inputs → exactly the same content and the same fingerprint", () => {
    const a = buildDhPrescriptionV2Content(DH_INPUT);
    const b = buildDhPrescriptionV2Content({ ...DH_INPUT, priorityAreas: [...DH_INPUT.priorityAreas], terrainAccess: [...ALL_TERRAIN] });
    expect(a).toEqual(b);
    expect(sportFingerprint(a)).toBe(sportFingerprint(b));
    expect(sportFingerprint(assignPrescriptionIds(a, () => crypto.randomUUID()))).toBe(sportFingerprint(assignPrescriptionIds(b, () => crypto.randomUUID())));
  });
});

describe("DH builder — locked blocks, never corrected", () => {
  it.each<[string, Partial<DhPrescriptionV2Input>, SessionModelV2GenerationBlockCode]>([
    ["tier null", { dhTechnicalTier: null }, "missing_dh_technical_tier"],
    ["no priority", { priorityAreas: [] }, "missing_dh_priority_areas"],
    ["four priorities", { priorityAreas: ["cornering", "braking", "jumps", "line_choice"] }, "too_many_dh_priority_areas"],
    ["duplicate priority", { priorityAreas: ["cornering", "cornering"] }, "duplicate_dh_priority_areas"],
    ["3 passages", { focusedRunsCount: 3 }, "dh_passes_out_of_range"],
    ["9 passages", { focusedRunsCount: 9 }, "dh_passes_out_of_range"],
    ["terrain of the canonical drill not declared", { terrainAccess: ["flow_trail"] }, "unavailable_dh_drill_terrain"],
  ])("%s → %s", (_label, override, code) => {
    expect(blockedCode(() => buildDhPrescriptionV2Content({ ...DH_INPUT, ...override }))).toBe(code);
  });

  it.each([4, 8])("%s passages → accepted on the main drill only", (count) => {
    const content = buildDhPrescriptionV2Content({ ...DH_INPUT, focusedRunsCount: count });
    expect(drillOf(content)).toMatchObject({ measure: { type: "pass", count } });
    assertValid(content);
  });

  it("an unavailable terrain never falls back to another priority, tier or drill", () => {
    // cornering/intermediate needs bermed_trail; the other priorities' drills would be available.
    expect(blockedCode(() => buildDhPrescriptionV2Content({ ...DH_INPUT, terrainAccess: ALL_TERRAIN.filter((t) => t !== "bermed_trail") }))).toBe("unavailable_dh_drill_terrain");
  });

  it("contract errors (not sport rules): wrong session kind, invalid ordinal, unknown skill", () => {
    expect(() => buildDhPrescriptionV2Content({ ...DH_INPUT, sessionKind: "DH_LIGHT" })).toThrow(SessionModelV2ContractError);
    expect(() => buildDhPrescriptionV2Content({ ...DH_INPUT, dhSessionOrdinal: -1 })).toThrow(SessionModelV2ContractError);
    expect(() => buildDhPrescriptionV2Content({ ...DH_INPUT, dhSessionOrdinal: 1.5 })).toThrow(SessionModelV2ContractError);
    expect(() => buildDhPrescriptionV2Content({ ...DH_INPUT, priorityAreas: ["wheelies"] })).toThrow(SessionModelV2ContractError);
  });
});

describe("deriveDhSessionOrdinals — plan date order, DH_TECHNICAL only", () => {
  it("numbers DH sessions 0, 1, 2… by date, ignoring other kinds and input order", () => {
    const ordinals = deriveDhSessionOrdinals([
      { date: "2026-10-12", kind: "DH_TECHNICAL" },
      { date: "2026-10-05", kind: "STRENGTH_LOWER" },
      { date: "2026-10-03", kind: "DH_TECHNICAL" },
      { date: "2026-10-10", kind: "AEROBIC_BASE" },
      { date: "2026-10-04", kind: "DH_TECHNICAL" },
    ]);
    expect([...ordinals.entries()]).toEqual([
      ["2026-10-03", 0],
      ["2026-10-04", 1],
      ["2026-10-12", 2],
    ]);
  });

  it("refuses two DH sessions on the same date (one session per day) instead of ordering them", () => {
    expect(() => deriveDhSessionOrdinals([{ date: "2026-10-03", kind: "DH_TECHNICAL" }, { date: "2026-10-03", kind: "DH_TECHNICAL" }])).toThrow(SessionModelV2ContractError);
  });
});

describe("AEROBIC_BASE builder", () => {
  const protocol = PROTOCOL_CATALOG_V2["endurance_base_continuous"]!;

  it.each([
    [45, 30],
    [60, 45],
    [90, 75],
  ])("%s min → 10 / %s / 5, validated once identified", (durationMin, main) => {
    const content = buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin, catalog: MANIFEST });
    expect(content.blocks.map((b) => [b.role, b.durationMinutes])).toEqual([
      ["warm_up", { min: 10, max: 10 }],
      ["main", { min: main, max: main }],
      ["cool_down", { min: 5, max: 5 }],
    ]);
    assertValid(content);
  });

  it.each([30, 35, 20, 44, 91])("%s min → unsupported_protocol_duration (no clamp, no compression)", (durationMin) => {
    expect(blockedCode(() => buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin, catalog: MANIFEST }))).toBe("unsupported_protocol_duration");
  });

  it("exact structure for 45 min: intent and activities from the protocol, RPE and talk test from the protocol, no item", () => {
    expect(buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 45, catalog: MANIFEST })).toEqual({
      schemaVersion: "v2",
      family: "endurance",
      sessionKind: "AEROBIC_BASE",
      intentId: "aerobic_base_lucidity",
      protocolId: "endurance_base_continuous",
      activitySelection: { mode: "restricted", activityIds: ["road_bike", "mtb_rolling", "home_trainer", "running"] },
      catalog: MANIFEST,
      blocks: [
        { role: "warm_up", durationMinutes: { min: 10, max: 10 }, rpeTarget: { min: 2, max: 3 }, instructionIds: ["instruction.endurance.activity_choice", "instruction.endurance.warm_up_easy"], items: [] },
        { role: "main", durationMinutes: { min: 30, max: 30 }, rpeTarget: { min: 3, max: 4 }, talkTestId: "instruction.endurance.talk_test_full_sentences", instructionIds: [], items: [] },
        { role: "cool_down", durationMinutes: { min: 5, max: 5 }, rpeTarget: { min: 2, max: 2 }, instructionIds: ["instruction.endurance.cool_down_easy"], items: [] },
      ],
    });
  });

  it("the activity list is the protocol's own list, in its order; the builder never picks one", () => {
    const content = buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 60, catalog: MANIFEST });
    expect(content.activitySelection).toEqual({ mode: "restricted", activityIds: [...protocol.activityOptions] });
    expect(content.intentId).toBe(protocol.intentId);
    expect(content.blocks.every((b) => b.items.length === 0)).toBe(true);
  });

  it("same input → same content and fingerprint; a different duration → a different fingerprint", () => {
    const a = buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 60, catalog: MANIFEST });
    const b = buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 60, catalog: MANIFEST });
    expect(a).toEqual(b);
    expect(sportFingerprint(a)).toBe(sportFingerprint(b));
    expect(sportFingerprint(buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 61, catalog: MANIFEST }))).not.toBe(sportFingerprint(a));
  });

  it("contract errors: another session kind, a non-integer duration", () => {
    expect(() => buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_INTERVALS", durationMin: 60, catalog: MANIFEST })).toThrow(SessionModelV2ContractError);
    expect(() => buildAerobicBasePrescriptionV2Content({ sessionKind: "AEROBIC_BASE", durationMin: 60.5, catalog: MANIFEST })).toThrow(SessionModelV2ContractError);
  });
});
