/**
 * P0-2 — DH TERRAIN COMPATIBILITY (HPM 2026-10-13).
 *
 * Decisions:
 * - a full DH track hosts the general trajectory, braking and control drills without artificially requiring
 *   a technical trail;
 * - explicit HPM decisions: a full DH track has off-camber sections and steep passages;
 * - a full DH track does NOT guarantee roots, rocks, a rock garden, jumps or another specific obstacle;
 * - a bike park keeps the bermed-turn conventions already approved (P0, 2026-10-12);
 * - race_execution_section_consistency is rideable on a flow trail (short, repeatable section, controlled pace);
 * - one drill per (skill, tier): unchanged. Compatibility only widens WHERE a drill can be ridden.
 */
import { describe, expect, it } from "vitest";
import { DH_SKILLS_V2, DH_TECHNICAL_TIERS_V2, SESSION_DRILL_CATALOG_V2, SESSION_DRILL_CATALOG_V2_ENTRIES, type DhSkillV2, type DhTechnicalTierV2 } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import { buildDhPrescriptionV2Content, canonicalDhDrill, dhDrillForLoad, ridesOn, type DhPrescriptionV2Input } from "../../src/sessionModelV2/builders/dhPrescriptionV2.js";
import { buildSessionModelV2CatalogManifest } from "../../src/sessionModelV2/catalogManifest.js";
import { SessionModelV2GenerationBlockedError } from "../../src/sessionModelV2/generationErrors.js";
import type { LoadProfile } from "../../src/types/sharedVocabulary.js";

const TERRAINS = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];
const BERMED = ["bermed_trail", "bike_park_jump_line", "full_dh_track"];
const LOADS: (LoadProfile | undefined)[] = [undefined, "LIGHT", "MODERATE", "HEAVY"];
const MANIFEST = buildSessionModelV2CatalogManifest();
const textOf = (id: string) => (COACHING_TEXT_CATALOG as Record<string, { text: Record<string, string> }>)[id]!.text["fr-CH"]!;
const drillTexts = (drillId: string) => `${textOf(`cue.${drillId}`)} ${textOf(`criterion.${drillId}`)}`;

/** Compatible terrains at the approved base (7fb2da1, P0 first generation) — frozen here as the "before". */
const BEFORE: Record<string, string[]> = {
  braking_progressive_control: ["any_groomed_trail", "flow_trail"],
  braking_late_entry: ["flow_trail", ...BERMED],
  braking_marked_zone_at_speed: ["technical_trail"],
  cornering_flat_turn_precision: ["flow_trail"],
  cornering_berm_speed: BERMED,
  cornering_off_camber: ["technical_trail"],
  line_choice_two_line_scan: ["technical_trail"],
  line_choice_rock_garden: ["rock_garden"],
  line_choice_fast_line_compare: ["rock_garden"],
  steep_terrain_controlled_roll_in: ["steep_technical_trail"],
  steep_terrain_body_position: ["steep_technical_trail"],
  steep_terrain_off_brake_chute: ["steep_technical_trail"],
  roots_rocks_rolling: ["root_rock_trail"],
  roots_rocks_unweighted_line: ["root_rock_trail"],
  roots_rocks_committed: ["root_rock_trail"],
  jumps_table_top_basic: ["bike_park_jump_line"],
  jumps_linked_tables: ["bike_park_jump_line"],
  jumps_step_down: ["bike_park_jump_line"],
  race_execution_section_consistency: ["any_groomed_trail"],
  race_execution_split_pace: ["technical_trail"],
  race_execution_full_run_sim: ["full_dh_track"],
};

/** P0-2 — exactly these additions, nothing else. */
const ADDED: Record<string, string[]> = {
  braking_progressive_control: ["full_dh_track"],
  braking_marked_zone_at_speed: ["full_dh_track"],
  cornering_flat_turn_precision: ["full_dh_track"],
  cornering_off_camber: ["full_dh_track"],
  line_choice_two_line_scan: ["full_dh_track"],
  steep_terrain_controlled_roll_in: ["full_dh_track"],
  steep_terrain_body_position: ["full_dh_track"],
  race_execution_section_consistency: ["flow_trail", "full_dh_track"],
  race_execution_split_pace: ["full_dh_track"],
};

/** Drills that need a feature a full DH track does not guarantee (roots, rocks, rock garden, jumps, a chute ridden off the brakes) or an explicit berm. */
const KEPT = ["steep_terrain_off_brake_chute", "line_choice_rock_garden", "line_choice_fast_line_compare", "roots_rocks_rolling", "roots_rocks_unweighted_line", "roots_rocks_committed", "jumps_table_top_basic", "jumps_linked_tables", "jumps_step_down", "cornering_berm_speed"];

/** The previous selection rule, with the BEFORE table (dhDrillForLoad of 7fb2da1). */
function previous(skill: DhSkillV2, tier: DhTechnicalTierV2, load: LoadProfile | undefined, terrains: string[]): string {
  const canonical = canonicalDhDrill(skill, tier);
  const rides = (id: string) => BEFORE[id]!.some((t) => terrains.includes(t));
  if (!rides(canonical.drillId)) return "blocked";
  const after = dhDrillForLoad(canonical, load, TERRAINS); // which drill the load asks for (terrain-free)
  if (after === null) return "blocked";
  return after.drillId === canonical.drillId || rides(after.drillId) || rides(canonical.drillId) ? after.drillId : "blocked";
}
function current(skill: DhSkillV2, tier: DhTechnicalTierV2, load: LoadProfile | undefined, terrains: string[]): string {
  const canonical = canonicalDhDrill(skill, tier);
  if (!ridesOn(canonical, terrains)) return "blocked";
  return dhDrillForLoad(canonical, load, terrains)?.drillId ?? "blocked";
}
const available = (terrains: string[], tier: DhTechnicalTierV2, rule: typeof current) => DH_SKILLS_V2.filter((s) => rule(s, tier, undefined, terrains) !== "blocked");

describe("P0-2 — DH terrain compatibility (HPM 2026-10-13)", () => {
  it("the catalogue is exactly the approved base plus the P0-2 additions; every drill keeps its reference terrain first", () => {
    expect(SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => d.drillId).sort()).toEqual(Object.keys(BEFORE).sort());
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      expect(d.compatibleTerrains, d.drillId).toEqual([...BEFORE[d.drillId]!, ...(ADDED[d.drillId] ?? [])]);
      expect(d.compatibleTerrains[0], d.drillId).toBe(d.requiredTerrain);
    }
  });

  it("intentionally kept: roots, rocks, rock garden and jumps are never granted by a full DH track (nor a bike park beyond jumps / berms)", () => {
    for (const id of KEPT) expect(SESSION_DRILL_CATALOG_V2[id]!.compatibleTerrains, id).toEqual(BEFORE[id]);
    for (const id of ["roots_rocks_rolling", "roots_rocks_unweighted_line", "roots_rocks_committed", "line_choice_rock_garden", "line_choice_fast_line_compare", "jumps_table_top_basic", "jumps_linked_tables", "jumps_step_down"]) {
      expect(SESSION_DRILL_CATALOG_V2[id]!.compatibleTerrains, id).not.toContain("full_dh_track");
    }
    for (const tier of DH_TECHNICAL_TIERS_V2) {
      for (const skill of ["roots_rocks", "jumps"] as DhSkillV2[]) expect(current(skill, tier, undefined, ["full_dh_track"]), `${skill}/${tier}`).toBe("blocked");
      expect(current("line_choice", tier, undefined, ["full_dh_track"]), tier).toBe(tier === "beginner" ? "line_choice_two_line_scan" : "blocked");
    }
    // A bike park alone adds nothing new: berms (P0) and jumps only.
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      if (d.compatibleTerrains.includes("bike_park_jump_line")) expect(BEFORE[d.drillId], d.drillId).toContain("bike_park_jump_line");
    }
    // The flow trail gains only the beginner race-execution drill.
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      if (d.compatibleTerrains.includes("flow_trail") && !BEFORE[d.drillId]!.includes("flow_trail")) expect(d.drillId).toBe("race_execution_section_consistency");
    }
  });

  it("sport check: no drill widened to the full DH track names a feature it does not guarantee; the specific features kept are exactly the HPM decisions", () => {
    for (const id of Object.keys(ADDED)) expect(drillTexts(id), id).not.toMatch(/racine|rocher|pierrier|saut|table|kick|relevé/i);
    // Specific features accepted on a full DH track by explicit HPM decision (2026-10-13):
    expect(drillTexts("cornering_off_camber")).toMatch(/dévers/);
    expect(drillTexts("steep_terrain_controlled_roll_in")).toMatch(/courte pente raide/);
    expect(drillTexts("steep_terrain_controlled_roll_in")).toMatch(/vitesse lente/);
    expect(drillTexts("steep_terrain_body_position")).toMatch(/à mesure que la pente se raidit/);
    // Final check: the chute ridden off the brakes needs a known chute — kept on the steep technical trail.
    expect(drillTexts("steep_terrain_off_brake_chute")).toMatch(/couloir/);
    expect(drillTexts("steep_terrain_off_brake_chute")).toMatch(/sans freiner/);
    expect(SESSION_DRILL_CATALOG_V2.steep_terrain_off_brake_chute!.compatibleTerrains).toEqual(["steep_technical_trail"]);
    // The flow-trail race drill: a short repeatable section at a pace the rider can repeat — no race intensity.
    expect(textOf("cue.race_execution_section_consistency")).toMatch(/courte section/);
    expect(textOf("cue.race_execution_section_consistency")).not.toMatch(/mode course|vitesse course/);
    // The kept drills really need their feature.
    for (const [id, re] of [["line_choice_rock_garden", /pierrier/], ["line_choice_fast_line_compare", /pierrier/], ["roots_rocks_unweighted_line", /racines/], ["jumps_linked_tables", /table-top/], ["cornering_berm_speed", /virage relevé/]] as [string, RegExp][]) {
      expect(drillTexts(id), id).toMatch(re);
    }
  });

  it("exhaustive non-regression against the approved base: every profile that generated keeps the same drill; newly allowed only through an added terrain", () => {
    let compared = 0;
    let newlyAllowed = 0;
    for (let mask = 0; mask < 1 << TERRAINS.length; mask += 1) {
      const terrains = TERRAINS.filter((_, i) => mask & (1 << i));
      for (const skill of DH_SKILLS_V2) {
        for (const tier of DH_TECHNICAL_TIERS_V2) {
          for (const load of LOADS) {
            const before = previous(skill, tier, load, terrains);
            const after = current(skill, tier, load, terrains);
            const key = `${skill}/${tier}/${load}/${terrains.join("+")}`;
            if (before !== "blocked") {
              expect(after, key).toBe(before);
              compared += 1;
            } else if (after !== "blocked") {
              const canonical = canonicalDhDrill(skill, tier);
              expect(ADDED[canonical.drillId], key).toBeDefined();
              expect(ADDED[canonical.drillId]!.some((t) => terrains.includes(t)), key).toBe(true);
              newlyAllowed += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
    expect(newlyAllowed).toBeGreaterThan(0);
  });

  it("matrix terrains × levels: priorities available before → after (the review matrix, plus the Astra profile)", () => {
    const row = (terrains: string[]) => DH_TECHNICAL_TIERS_V2.map((tier) => `${available(terrains, tier, previous).length}->${available(terrains, tier, current).length}`).join(" ");
    expect(row(["full_dh_track"])).toBe("0->5 2->4 1->3");
    expect(row(["bike_park_jump_line", "full_dh_track"])).toBe("1->6 3->5 2->4");
    expect(row(["technical_trail", "root_rock_trail", "full_dh_track"])).toBe("2->6 4->5 4->4");
    expect(row(["flow_trail"])).toBe("2->3 1->1 0->0");
    expect(row(["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"])).toBe("3->7 5->6 5->5");
    // What stays unavailable on a full DH track alone is exactly what needs a feature it does not guarantee.
    expect(DH_SKILLS_V2.filter((s) => !available(["full_dh_track"], "intermediate", current).includes(s))).toEqual(["line_choice", "roots_rocks", "jumps"]);
    expect(DH_SKILLS_V2.filter((s) => !available(["full_dh_track"], "advanced", current).includes(s))).toEqual(["line_choice", "steep_terrain", "roots_rocks", "jumps"]);
    expect(DH_SKILLS_V2.filter((s) => !available(["full_dh_track"], "beginner", current).includes(s))).toEqual(["roots_rocks", "jumps"]);
  });
});

/** The five HPM profiles (P0-2 mandate), at the DH builder: every DH session of a cycle, every load. */
const PROFILES: { name: string; tier: DhTechnicalTierV2; priorities: DhSkillV2[]; terrains: string[]; before: string; after: string[] }[] = [
  { name: "A — national advanced, bike park + full DH track", tier: "advanced", priorities: ["cornering", "braking", "race_execution"], terrains: ["bike_park_jump_line", "full_dh_track"], before: "blocked:cornering", after: ["cornering_off_camber", "braking_marked_zone_at_speed", "race_execution_full_run_sim"] },
  { name: "B — beginner, full DH track only", tier: "beginner", priorities: ["braking", "cornering", "line_choice"], terrains: ["full_dh_track"], before: "blocked:braking", after: ["braking_progressive_control", "cornering_flat_turn_precision", "line_choice_two_line_scan"] },
  { name: "C — beginner, flow trail only", tier: "beginner", priorities: ["braking", "cornering", "race_execution"], terrains: ["flow_trail"], before: "blocked:race_execution", after: ["braking_progressive_control", "cornering_flat_turn_precision", "race_execution_section_consistency"] },
  { name: "D — amateur, the 9 October profile", tier: "intermediate", priorities: ["cornering", "braking"], terrains: ["technical_trail", "root_rock_trail", "full_dh_track"], before: "generated", after: ["cornering_berm_speed", "braking_late_entry"] },
  { name: "E — national, the Astra review (5 terrains)", tier: "advanced", priorities: ["cornering", "braking", "roots_rocks"], terrains: ["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"], before: "generated", after: ["cornering_off_camber", "braking_marked_zone_at_speed", "roots_rocks_committed"] },
];

const drillOf = (i: DhPrescriptionV2Input): string => {
  try {
    return buildDhPrescriptionV2Content(i).blocks.flatMap((b) => b.items).find((x) => x.kind === "drill")!.drillId as string;
  } catch (error) {
    if (error instanceof SessionModelV2GenerationBlockedError) return `blocked:${error.code}`;
    throw error;
  }
};

describe("P0-2 — profiles A–E at the DH builder", () => {
  for (const p of PROFILES) {
    it(p.name, () => {
      const firstBlocked = p.priorities.find((s) => previous(s, p.tier, undefined, p.terrains) === "blocked");
      expect(firstBlocked ? `blocked:${firstBlocked}` : "generated").toBe(p.before);
      const base = { sessionKind: "DH_TECHNICAL" as const, dhTechnicalTier: p.tier, priorityAreas: p.priorities, terrainAccess: p.terrains, focusedRunsCount: 6, catalog: MANIFEST };
      expect(p.priorities.map((_, ordinal) => drillOf({ ...base, dhSessionOrdinal: ordinal }))).toEqual(p.after);
      for (let ordinal = 0; ordinal < p.priorities.length * 2; ordinal += 1) {
        for (const load of LOADS) {
          const id = drillOf({ ...base, dhSessionOrdinal: ordinal, ...(load ? { loadProfile: load } : {}) });
          expect(id, `${ordinal}/${load}`).not.toMatch(/^blocked/);
          const drill = SESSION_DRILL_CATALOG_V2[id]!;
          // Rideable on a declared terrain — a LIGHT regression on its own terrain or on its parent's.
          const parent = canonicalDhDrill(p.priorities[ordinal % p.priorities.length]!, p.tier);
          expect(ridesOn(drill, p.terrains) || ridesOn(parent, p.terrains), `${id} on ${p.terrains.join("+")}`).toBe(true);
          expect(drill.skill).toBe(p.priorities[ordinal % p.priorities.length]);
        }
      }
    });
  }
});
