/**
 * P0 FIRST GENERATION (HPM 2026-10-12) — drill terrain compatibility.
 *
 * Decision: bike park and full DH track give access to bermed turns (as an explicitly bermed trail);
 * NOT technical trails nor root / rock trails; flow trail keeps its existing definition.
 * Applied to the two drills that blocked the 9 October review profile:
 *   cornering_berm_speed (needs a bermed turn) and braking_late_entry (needs a turn entry).
 * Final HPM decision (2026-10-12): a flow trail counts as a groomed trail — applied to
 *   braking_progressive_control only (its texts need a rider-marked braking zone, nothing else).
 * The (skill, tier) → drill rule is unchanged: compatibility only widens WHERE a drill can be ridden.
 */
import { describe, expect, it } from "vitest";
import { BERMED_TURN_TERRAINS_V1, DH_SKILLS_V2, DH_TECHNICAL_TIERS_V2, SESSION_DRILL_CATALOG_V2, SESSION_DRILL_CATALOG_V2_ENTRIES, type SessionDrillV2 } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import { buildDhPrescriptionV2Content, canonicalDhDrill, dhDrillForLoad, RACE_SPEED_DRILL_IDS_V2, type DhPrescriptionV2Input } from "../../src/sessionModelV2/builders/dhPrescriptionV2.js";
import { buildSessionModelV2CatalogManifest } from "../../src/sessionModelV2/catalogManifest.js";
import { SessionModelV2GenerationBlockedError } from "../../src/sessionModelV2/generationErrors.js";
import type { LoadProfile } from "../../src/types/sharedVocabulary.js";

const TERRAINS = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];
const REVIEW_TERRAINS = ["technical_trail", "root_rock_trail", "full_dh_track"];
// P0 (2026-10-12) — then widened further by P0-2 (HPM 2026-10-13, tests/unit/p0_2DhTerrainCompatibility.test.ts).
const WIDENED_P0 = ["cornering_berm_speed", "braking_late_entry", "braking_progressive_control"];
const WIDENED_P0_2 = [
  "braking_progressive_control", "braking_marked_zone_at_speed", "cornering_flat_turn_precision", "cornering_off_camber", "line_choice_two_line_scan",
  "steep_terrain_controlled_roll_in", "steep_terrain_body_position", "steep_terrain_off_brake_chute", "race_execution_section_consistency", "race_execution_split_pace",
];
const WIDENED = [...new Set([...WIDENED_P0, ...WIDENED_P0_2])];
const MANIFEST = buildSessionModelV2CatalogManifest();
const textOf = (id: string) => (COACHING_TEXT_CATALOG as Record<string, { text: Record<string, string> }>)[id]!.text["fr-CH"]!;

const input = (over: Partial<DhPrescriptionV2Input>): DhPrescriptionV2Input => ({
  sessionKind: "DH_TECHNICAL", dhSessionOrdinal: 0, dhTechnicalTier: "intermediate", priorityAreas: ["cornering", "braking"], terrainAccess: REVIEW_TERRAINS, focusedRunsCount: 6, catalog: MANIFEST, ...over,
});
const drillIdOf = (i: DhPrescriptionV2Input): string => {
  try {
    const content = buildDhPrescriptionV2Content(i);
    return content.blocks.flatMap((b) => b.items).find((x) => x.kind === "drill")!.drillId as string;
  } catch (error) {
    if (error instanceof SessionModelV2GenerationBlockedError) return `blocked:${error.code}`;
    throw error;
  }
};

describe("P0 first generation — drill terrain compatibility", () => {
  it("the HPM rule, exactly: bermed turns on a bermed trail, a bike park or a full DH track — not technical / root-rock trails, not (yet) a flow trail", () => {
    expect([...BERMED_TURN_TERRAINS_V1]).toEqual(["bermed_trail", "bike_park_jump_line", "full_dh_track"]);
    expect(SESSION_DRILL_CATALOG_V2.cornering_berm_speed!.compatibleTerrains).toEqual(["bermed_trail", "bike_park_jump_line", "full_dh_track"]);
    expect(SESSION_DRILL_CATALOG_V2.braking_late_entry!.compatibleTerrains).toEqual(["flow_trail", "bermed_trail", "bike_park_jump_line", "full_dh_track"]);
    for (const t of ["technical_trail", "root_rock_trail", "flow_trail"]) expect(SESSION_DRILL_CATALOG_V2.cornering_berm_speed!.compatibleTerrains, t).not.toContain(t);
    for (const t of ["technical_trail", "root_rock_trail"]) expect(SESSION_DRILL_CATALOG_V2.braking_late_entry!.compatibleTerrains, t).not.toContain(t);
    // P0-2 (HPM 2026-10-13) added the full DH track.
    expect(SESSION_DRILL_CATALOG_V2.braking_progressive_control!.compatibleTerrains).toEqual(["any_groomed_trail", "flow_trail", "full_dh_track"]);
  });

  it("no other drill was widened (P0 then P0-2); every drill keeps its reference terrain first (V1 terrainRequirement)", () => {
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      expect(d.compatibleTerrains[0], d.drillId).toBe(d.requiredTerrain);
      if (!WIDENED.includes(d.drillId)) expect(d.compatibleTerrains, d.drillId).toEqual([d.requiredTerrain]);
    }
  });

  it("sport compatibility of the retained drills: their validated texts need a turn (entry) / a bermed turn — which the added terrains provide", () => {
    expect(textOf("cue.cornering_berm_speed")).toMatch(/virage relevé/);
    expect(textOf("criterion.cornering_berm_speed")).toMatch(/virage relevé/);
    expect(textOf("cue.braking_late_entry")).toMatch(/entrée du virage/);
    expect(textOf("criterion.braking_late_entry")).toMatch(/virage/);
    // Neither is a race-intensity drill nor above the intermediate level.
    for (const id of ["cornering_berm_speed", "braking_late_entry"]) {
      expect(RACE_SPEED_DRILL_IDS_V2.has(id)).toBe(false);
      expect(SESSION_DRILL_CATALOG_V2[id]!.technicalTier).toBe("intermediate");
    }
  });

  it("profile B (beginner, flow trail only, braking): the beginner braking drill on the flow trail — rideable as written, still beginner", () => {
    expect(textOf("cue.braking_progressive_control")).toMatch(/zone marquée/);
    expect(textOf("criterion.braking_progressive_control")).toMatch(/zone de freinage/);
    expect(textOf("cue.braking_progressive_control")).not.toMatch(/virage|relevé|racine|rocher|saut/);
    expect(SESSION_DRILL_CATALOG_V2.braking_progressive_control!.technicalTier).toBe("beginner");
    expect(RACE_SPEED_DRILL_IDS_V2.has("braking_progressive_control")).toBe(false);
    const beginner = input({ dhTechnicalTier: "beginner", priorityAreas: ["braking", "cornering"], terrainAccess: ["flow_trail"] });
    expect(drillIdOf({ ...beginner, dhSessionOrdinal: 0 })).toBe("braking_progressive_control");
    expect(drillIdOf({ ...beginner, dhSessionOrdinal: 1 })).toBe("cornering_flat_turn_precision");
    // P0-2 (HPM 2026-10-13): the beginner race-execution drill (a short repeatable section at controlled pace) is rideable on a flow trail.
    expect(drillIdOf({ ...beginner, priorityAreas: ["race_execution"] })).toBe("race_execution_section_consistency");
  });

  it("the 9 October review profile (intermediate, cornering + braking, technical / root-rock / full DH track) now gets its two priorities on the full DH track", () => {
    expect(drillIdOf(input({ dhSessionOrdinal: 0 }))).toBe("cornering_berm_speed");
    expect(drillIdOf(input({ dhSessionOrdinal: 1 }))).toBe("braking_late_entry");
    expect(drillIdOf(input({ dhSessionOrdinal: 0, loadProfile: "LIGHT" }))).toBe("cornering_berm_speed");
    // Without the full DH track (technical + root-rock only): still refused, never another drill.
    expect(drillIdOf(input({ terrainAccess: ["technical_trail", "root_rock_trail"] }))).toBe("blocked:unavailable_dh_drill_terrain");
  });

  it("exhaustive non-regression: wherever the previous rule (reference terrain only) produced a drill, the same drill is produced — every skill, tier, load and terrain set (512)", () => {
    const previous = (skill: (typeof DH_SKILLS_V2)[number], tier: (typeof DH_TECHNICAL_TIERS_V2)[number], load: LoadProfile | undefined, terrains: string[]): string => {
      const canonical = canonicalDhDrill(skill, tier);
      if (!terrains.includes(canonical.requiredTerrain)) return "blocked";
      if (load !== "LIGHT" || !RACE_SPEED_DRILL_IDS_V2.has(canonical.drillId)) return canonical.drillId;
      let current: SessionDrillV2 | undefined = canonical;
      while (current && RACE_SPEED_DRILL_IDS_V2.has(current.drillId)) current = current.regressesTo ? SESSION_DRILL_CATALOG_V2[current.regressesTo] : undefined;
      return current && (terrains.includes(current.requiredTerrain) || terrains.includes(canonical.requiredTerrain)) ? current.drillId : "blocked";
    };
    let compared = 0;
    let newlyAllowed = 0;
    for (let mask = 0; mask < 1 << TERRAINS.length; mask += 1) {
      const terrains = TERRAINS.filter((_, i) => mask & (1 << i));
      for (const skill of DH_SKILLS_V2) {
        for (const tier of DH_TECHNICAL_TIERS_V2) {
          for (const load of [undefined, "LIGHT", "MODERATE", "HEAVY"] as (LoadProfile | undefined)[]) {
            const before = previous(skill, tier, load, terrains);
            const canonical = canonicalDhDrill(skill, tier);
            const after = canonical.compatibleTerrains.some((t) => terrains.includes(t)) ? dhDrillForLoad(canonical, load, terrains)?.drillId ?? "blocked" : "blocked";
            if (before !== "blocked") {
              expect(after, `${skill}/${tier}/${load}/${terrains.join("+")}`).toBe(before);
              compared += 1;
            } else if (after !== "blocked") {
              // Newly allowed only for the widened drills, and only through one of their compatible terrains.
              expect(WIDENED).toContain(canonical.drillId);
              newlyAllowed += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
    expect(newlyAllowed).toBeGreaterThan(0);
  });
});
