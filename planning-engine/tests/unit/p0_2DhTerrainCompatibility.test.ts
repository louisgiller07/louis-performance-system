/**
 * P0-2 — DH TERRAIN COMPATIBILITY (HPM 2026-10-13, final decisions — option E).
 *
 * - A full DH track hosts the general trajectory, braking and control drills without artificially
 *   requiring a technical trail. It does NOT guarantee an off-camber section, a particularly steep
 *   section, roots, rocks, a rock garden, jumps or another specific obstacle.
 * - The off-camber drill is selected only where an off-camber section is CONFIRMED: the rider declares
 *   the optional « Virages en dévers » terrain feature. A technical trail alone does not confirm one.
 * - Option E: at most ONE explicit alternative per (skill, tier) reference drill, same skill and tier,
 *   selected only when no declared terrain allows the reference drill. Today: cornering_advanced_line_exit
 *   for cornering_off_camber (any available turn; no off-camber, no berm).
 * - The three steep drills keep their specific terrain (steep technical trail).
 * - race_execution_section_consistency is rideable on a flow trail.
 * - Content added without a catalogue version change (strictly additive for stored ids and texts).
 */
import { describe, expect, it } from "vitest";
import { DH_SKILLS_V2, DH_TECHNICAL_TIERS_V2, OFF_CAMBER_SECTION, SESSION_DRILL_CATALOG_V2, SESSION_DRILL_CATALOG_V2_ENTRIES, type DhSkillV2, type DhTechnicalTierV2 } from "../../src/catalog/sessionDrillCatalogV2.js";
import { COACHING_TEXT_CATALOG } from "../../src/catalog/coachingTextCatalog.js";
import { alternativeDhDrill, buildDhPrescriptionV2Content, canonicalDhDrill, dhDrillForLoad, dhIntentForDrillV2, RACE_SPEED_DRILL_IDS_V2, ridesOn, selectDhDrill, type DhPrescriptionV2Input } from "../../src/sessionModelV2/builders/dhPrescriptionV2.js";
import { buildSessionModelV2CatalogManifest } from "../../src/sessionModelV2/catalogManifest.js";
import { SessionModelV2GenerationBlockedError } from "../../src/sessionModelV2/generationErrors.js";
import { assertValidTerrainAccess } from "../../src/validation/validatePlanInputSnapshot.js";
import type { LoadProfile } from "../../src/types/sharedVocabulary.js";

const BASE_TERRAINS = ["any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "rock_garden", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"];
const TERRAINS = [...BASE_TERRAINS, OFF_CAMBER_SECTION];
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

/** The final P0-2 catalogue, exactly. */
const AFTER: Record<string, string[]> = {
  ...BEFORE,
  braking_progressive_control: ["any_groomed_trail", "flow_trail", "full_dh_track"],
  braking_marked_zone_at_speed: ["technical_trail", "full_dh_track"],
  cornering_flat_turn_precision: ["flow_trail", "full_dh_track"],
  cornering_off_camber: [OFF_CAMBER_SECTION],
  cornering_advanced_line_exit: ["full_dh_track", "any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line"],
  line_choice_two_line_scan: ["technical_trail", "full_dh_track"],
  race_execution_section_consistency: ["any_groomed_trail", "flow_trail", "full_dh_track"],
  race_execution_split_pace: ["technical_trail", "full_dh_track"],
};

/** The previous selection rule, with the BEFORE table (7fb2da1): the one drill of (skill, tier), its LIGHT regression. */
function previous(skill: DhSkillV2, tier: DhTechnicalTierV2, load: LoadProfile | undefined, terrains: string[]): string {
  const reference = canonicalDhDrill(skill, tier);
  if (!BEFORE[reference.drillId]!.some((t) => terrains.includes(t))) return "blocked";
  return dhDrillForLoad(reference, load, BASE_TERRAINS)?.drillId ?? "blocked";
}
function current(skill: DhSkillV2, tier: DhTechnicalTierV2, load: LoadProfile | undefined, terrains: string[]): string {
  const selected = selectDhDrill(skill, tier, terrains);
  return selected === null ? "blocked" : dhDrillForLoad(selected, load, terrains)?.drillId ?? "blocked";
}
const available = (terrains: string[], tier: DhTechnicalTierV2, rule: typeof current) => DH_SKILLS_V2.filter((s) => rule(s, tier, undefined, terrains) !== "blocked");

describe("P0-2 — catalogue and selection (HPM 2026-10-13, option E)", () => {
  it("the catalogue is exactly the approved base plus the final P0-2 changes; every drill keeps its reference terrain first", () => {
    expect(SESSION_DRILL_CATALOG_V2_ENTRIES.map((d) => d.drillId).sort()).toEqual(Object.keys(AFTER).sort());
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      expect(d.compatibleTerrains, d.drillId).toEqual(AFTER[d.drillId]);
      expect(d.compatibleTerrains[0], d.drillId).toBe(d.requiredTerrain);
    }
    // Every terrain is declarable (closed vocabulary, shared validation).
    expect(() => assertValidTerrainAccess(TERRAINS)).not.toThrow();
  });

  it("option E: exactly one explicit alternative, of the off-camber drill — same skill, same tier, no race intensity, no off-camber / berm in its texts", () => {
    const alternatives = SESSION_DRILL_CATALOG_V2_ENTRIES.filter((d) => d.alternativeFor !== undefined);
    expect(alternatives.map((d) => [d.drillId, d.alternativeFor])).toEqual([["cornering_advanced_line_exit", "cornering_off_camber"]]);
    const alt = SESSION_DRILL_CATALOG_V2.cornering_advanced_line_exit!;
    expect([alt.skill, alt.technicalTier, alt.origin]).toEqual(["cornering", "advanced", "v2_only"]);
    expect(RACE_SPEED_DRILL_IDS_V2.has(alt.drillId)).toBe(false);
    expect(alternativeDhDrill(canonicalDhDrill("cornering", "advanced"))!.drillId).toBe("cornering_advanced_line_exit");
    for (const skill of DH_SKILLS_V2) for (const tier of DH_TECHNICAL_TIERS_V2) if (!(skill === "cornering" && tier === "advanced")) expect(alternativeDhDrill(canonicalDhDrill(skill, tier)), `${skill}/${tier}`).toBeNull();
    // Draft texts (HPM 2026-10-13), not sport-approved: no imposed late apex, full brake release or speed increase.
    expect(drillTexts(alt.drillId)).not.toMatch(/dévers|relevé|racine|rocher|saut|pédal|corde tardi|lâche|relâche|plus vite|accélèr/i);
    expect(textOf("cue.cornering_advanced_line_exit")).toMatch(/sans perdre le contrôle de la vitesse/);
    expect(dhIntentForDrillV2(alt)).toBe("dh_corner_line_control");
    expect(dhIntentForDrillV2(SESSION_DRILL_CATALOG_V2.cornering_off_camber!)).toBe("dh_corner_exit_speed");
  });

  it("the specific off-camber drill only where an off-camber section is confirmed; the alternative otherwise; never another tier or skill", () => {
    expect(selectDhDrill("cornering", "advanced", [OFF_CAMBER_SECTION])!.drillId).toBe("cornering_off_camber");
    expect(selectDhDrill("cornering", "advanced", ["technical_trail", OFF_CAMBER_SECTION])!.drillId).toBe("cornering_off_camber");
    // A technical trail alone, or a full DH track, is not a confirmation.
    expect(selectDhDrill("cornering", "advanced", ["technical_trail"])!.drillId).toBe("cornering_advanced_line_exit");
    expect(selectDhDrill("cornering", "advanced", ["full_dh_track"])!.drillId).toBe("cornering_advanced_line_exit");
    // No available turn at all (a rock garden alone): refused, with every terrain that would make the priority possible.
    expect(selectDhDrill("cornering", "advanced", ["rock_garden"])).toBeNull();
    const input: DhPrescriptionV2Input = { sessionKind: "DH_TECHNICAL", dhSessionOrdinal: 0, dhTechnicalTier: "advanced", priorityAreas: ["cornering"], terrainAccess: ["rock_garden"], focusedRunsCount: 6, catalog: MANIFEST };
    try {
      buildDhPrescriptionV2Content(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SessionModelV2GenerationBlockedError);
      expect((error as SessionModelV2GenerationBlockedError).detail).toEqual({ skill: "cornering", dhTechnicalTier: "advanced", drillId: "cornering_off_camber", requiredTerrain: OFF_CAMBER_SECTION, compatibleTerrains: [OFF_CAMBER_SECTION, ...AFTER.cornering_advanced_line_exit!] });
    }
  });

  it("intentionally kept: off-camber, steep, roots, rocks, rock garden, jumps and berm drills are never granted by a full DH track", () => {
    for (const id of ["cornering_off_camber", "steep_terrain_controlled_roll_in", "steep_terrain_body_position", "steep_terrain_off_brake_chute", "roots_rocks_rolling", "roots_rocks_unweighted_line", "roots_rocks_committed", "line_choice_rock_garden", "line_choice_fast_line_compare", "jumps_table_top_basic", "jumps_linked_tables", "jumps_step_down"]) {
      expect(SESSION_DRILL_CATALOG_V2[id]!.compatibleTerrains, id).not.toContain("full_dh_track");
    }
    for (const id of ["steep_terrain_controlled_roll_in", "steep_terrain_body_position", "steep_terrain_off_brake_chute"]) expect(SESSION_DRILL_CATALOG_V2[id]!.compatibleTerrains, id).toEqual(["steep_technical_trail"]);
    for (const tier of DH_TECHNICAL_TIERS_V2) for (const skill of ["steep_terrain", "roots_rocks", "jumps"] as DhSkillV2[]) expect(current(skill, tier, undefined, ["full_dh_track"]), `${skill}/${tier}`).toBe("blocked");
    // The flow trail gains only the beginner race-execution drill (and turns for the alternative).
    for (const d of SESSION_DRILL_CATALOG_V2_ENTRIES) {
      if (d.compatibleTerrains.includes("flow_trail") && !(BEFORE[d.drillId] ?? []).includes("flow_trail")) expect(["race_execution_section_consistency", "cornering_advanced_line_exit"]).toContain(d.drillId);
    }
  });

  it("sport check: no drill widened to the full DH track names a feature it does not guarantee", () => {
    for (const id of ["braking_progressive_control", "braking_marked_zone_at_speed", "cornering_flat_turn_precision", "line_choice_two_line_scan", "race_execution_section_consistency", "race_execution_split_pace", "cornering_advanced_line_exit"]) {
      expect(drillTexts(id), id).not.toMatch(/racine|rocher|pierrier|saut|table-top|kick|relevé|dévers|raide|couloir/i);
    }
    for (const [id, re] of [["cornering_off_camber", /dévers/], ["steep_terrain_controlled_roll_in", /pente raide/], ["steep_terrain_off_brake_chute", /couloir/], ["line_choice_rock_garden", /pierrier/], ["roots_rocks_unweighted_line", /racines/], ["jumps_linked_tables", /table-top/], ["cornering_berm_speed", /virage relevé/]] as [string, RegExp][]) {
      expect(drillTexts(id), id).toMatch(re);
    }
  });

  it("exhaustive non-regression against the approved base (1024 terrain sets × skills × tiers × loads): one documented difference only", () => {
    let same = 0;
    let documented = 0;
    let newlyAllowed = 0;
    for (let mask = 0; mask < 1 << TERRAINS.length; mask += 1) {
      const terrains = TERRAINS.filter((_, i) => mask & (1 << i));
      for (const skill of DH_SKILLS_V2) {
        for (const tier of DH_TECHNICAL_TIERS_V2) {
          for (const load of LOADS) {
            const before = previous(skill, tier, load, terrains);
            const after = current(skill, tier, load, terrains);
            const key = `${skill}/${tier}/${load}/${terrains.join("+")}`;
            if (before !== "blocked" && before === after) same += 1;
            else if (before !== "blocked") {
              // The one legitimate difference: an advanced cornering rider WITHOUT a confirmed off-camber section
              // (it was granted by a technical trail alone) now receives the general alternative.
              expect([skill, tier, before, after, terrains.includes(OFF_CAMBER_SECTION)], key).toEqual(["cornering", "advanced", "cornering_off_camber", "cornering_advanced_line_exit", false]);
              documented += 1;
            } else if (after !== "blocked") {
              const selected = selectDhDrill(skill, tier, terrains)!;
              const added = (AFTER[selected.drillId] ?? []).filter((t) => !(BEFORE[selected.drillId] ?? []).includes(t));
              expect(added.some((t) => terrains.includes(t)), key).toBe(true);
              newlyAllowed += 1;
            }
          }
        }
      }
    }
    expect(same).toBeGreaterThan(20_000);
    expect(documented).toBeGreaterThan(0);
    expect(newlyAllowed).toBeGreaterThan(0);
  });

  it("matrix terrains × levels: priorities available before → after (no off-camber section declared)", () => {
    const row = (terrains: string[]) => DH_TECHNICAL_TIERS_V2.map((tier) => `${available(terrains, tier, previous).length}->${available(terrains, tier, current).length}`).join(" ");
    expect(row(["full_dh_track"])).toBe("0->4 2->3 1->3");
    expect(row(["bike_park_jump_line", "full_dh_track"])).toBe("1->5 3->4 2->4");
    expect(row(["technical_trail", "root_rock_trail", "full_dh_track"])).toBe("2->5 4->4 4->4");
    expect(row(["flow_trail"])).toBe("2->3 1->1 0->1");
    expect(row(["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"])).toBe("3->6 5->5 5->5");
    expect(DH_SKILLS_V2.filter((s) => !available(["full_dh_track"], "advanced", current).includes(s))).toEqual(["line_choice", "steep_terrain", "roots_rocks", "jumps"]);
  });
});

/** The five HPM profiles (P0-2 mandate) at the DH builder, plus E with a declared off-camber section. */
const PROFILES: { name: string; tier: DhTechnicalTierV2; priorities: DhSkillV2[]; terrains: string[]; before: string; after: string[] }[] = [
  { name: "A — national advanced, bike park + full DH track", tier: "advanced", priorities: ["cornering", "braking", "race_execution"], terrains: ["bike_park_jump_line", "full_dh_track"], before: "blocked:cornering", after: ["cornering_advanced_line_exit", "braking_marked_zone_at_speed", "race_execution_full_run_sim"] },
  { name: "B — beginner, full DH track only", tier: "beginner", priorities: ["braking", "cornering", "line_choice"], terrains: ["full_dh_track"], before: "blocked:braking", after: ["braking_progressive_control", "cornering_flat_turn_precision", "line_choice_two_line_scan"] },
  { name: "C — beginner, flow trail only", tier: "beginner", priorities: ["braking", "cornering", "race_execution"], terrains: ["flow_trail"], before: "blocked:race_execution", after: ["braking_progressive_control", "cornering_flat_turn_precision", "race_execution_section_consistency"] },
  { name: "D — amateur, the 9 October profile", tier: "intermediate", priorities: ["cornering", "braking"], terrains: ["technical_trail", "root_rock_trail", "full_dh_track"], before: "generated", after: ["cornering_berm_speed", "braking_late_entry"] },
  // Documented difference: a technical trail no longer confirms an off-camber section.
  { name: "E — national, the Astra review (5 terrains)", tier: "advanced", priorities: ["cornering", "braking", "roots_rocks"], terrains: ["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track"], before: "generated", after: ["cornering_advanced_line_exit", "braking_marked_zone_at_speed", "roots_rocks_committed"] },
  { name: "E + declared off-camber section", tier: "advanced", priorities: ["cornering", "braking", "roots_rocks"], terrains: ["bermed_trail", "technical_trail", "root_rock_trail", "bike_park_jump_line", "full_dh_track", OFF_CAMBER_SECTION], before: "generated", after: ["cornering_off_camber", "braking_marked_zone_at_speed", "roots_rocks_committed"] },
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
          const skill = p.priorities[ordinal % p.priorities.length]!;
          const selected = selectDhDrill(skill, p.tier, p.terrains)!;
          // Rideable on a declared terrain — a LIGHT regression on its own terrain or on its parent's.
          expect(ridesOn(drill, p.terrains) || ridesOn(selected, p.terrains), `${id} on ${p.terrains.join("+")}`).toBe(true);
          expect([drill.skill, selected.technicalTier]).toEqual([skill, p.tier]);
        }
      }
    });
  }
});
