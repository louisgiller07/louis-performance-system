/**
 * UX-11A.5a.2a — Session Model V2 DH drill catalogue.
 *
 * STRICT V1 / V2 ISOLATION (ADR UX-11A.5a.2a), same discipline as
 * sessionExerciseCatalogV2.ts:
 * - drillCatalog.ts (V1, version "v3") stays byte-for-byte unchanged and keeps
 *   driving every V1 plan, including V1's current tier coupling
 *   (difficulty === strengthExperienceTier), which is NOT carried over here.
 * - This catalogue has its own version and is not read by any engine yet.
 * - The 21 V1 drillIds are kept ("v1_enriched"); skill, tier and required
 *   terrain are identical to V1 (checked by tests); only V2 metadata is added.
 *
 * Future V2 selection (not implemented here, ADR UX-11A.5a.2a):
 *   declared priority → skill ; declared dhTechnicalTier + compatible terrain → drill.
 * The tier here is the drill's own difficulty, to be matched against the
 * rider's DECLARED dhTechnicalTier — never strengthExperienceTier,
 * competition level, results or an inferred weakness.
 *
 * Measure: passes, 4–8 per the Session Model rule (03). Only the technical
 * drill is counted; the rest of a DH session is uncounted instructions
 * (see sessionFrameV2.ts). The criterion describes ONE passage (success
 * true / false); no aggregated threshold and no stopwatch requirement.
 *
 * Every entry: PROVISIONAL — coaching validation required.
 *
 * INT-01 compatibility release (HPM 2026-10-13, option d): this runtime READS the plans a later release
 * (P0 first generation / P0-2) may have generated under the same aggregate session-model-v2.6, but never
 * generates their new content: the V2-only drill cornering_advanced_line_exit is known (validation, daily
 * KEEP / MODIFY, display) and never selected (canonicalDhDrill excludes alternatives); `compatibleTerrains`
 * (HPM P0 / P0-2 terrain decisions, always starting with requiredTerrain) serves only the daily LIGHT
 * regression of a stored plan — generation still requires requiredTerrain, unchanged.
 */
import type { ContentValidationStatus } from "./coachingTextCatalog.js";

export const SESSION_DRILL_CATALOG_V2_VERSION = "session-drills-v2.0";

export const DH_SKILLS_V2 = ["braking", "cornering", "line_choice", "steep_terrain", "roots_rocks", "jumps", "race_execution"] as const;
export type DhSkillV2 = (typeof DH_SKILLS_V2)[number];

export const DH_TECHNICAL_TIERS_V2 = ["beginner", "intermediate", "advanced"] as const;
export type DhTechnicalTierV2 = (typeof DH_TECHNICAL_TIERS_V2)[number];

/** Session Model rule (03): 4 to 8 passes, for the technical drill only. */
export const DH_DRILL_PASSES_RANGE_V2 = { min: 4, max: 8 } as const;

export interface SessionDrillV2 {
  drillId: string;
  /** "v1_enriched": one of the 21 V1 drills; "v2_only": a later V2 drill, known here but never selected. */
  origin: "v1_enriched" | "v2_only";
  skill: DhSkillV2;
  /** The drill's own difficulty, matched later against the rider's declared dhTechnicalTier. */
  technicalTier: DhTechnicalTierV2;
  requiredTerrain: string;
  /**
   * INT-01 compatibility — every terrain on which the drill's texts can be ridden as written (HPM P0 / P0-2),
   * starting with requiredTerrain. Read side only: the daily LIGHT regression of a stored plan (dhDrillForLoad).
   */
  compatibleTerrains: readonly string[];
  /** INT-01 compatibility — set on a V2-only alternative: the reference drill it stands in for; never selected here. */
  alternativeFor?: string;
  // UX-11B.2.3 — single measure vocabulary with recorded sets: "pass", never "passes".
  measureType: "pass";
  passes: { min: number; max: number };
  cueId: string;
  criterionId: string;
  vigilanceIds: readonly string[];
  progressesTo?: string;
  regressesTo?: string;
  validationStatus: ContentValidationStatus;
}

function drill(
  drillId: string,
  skill: DhSkillV2,
  technicalTier: DhTechnicalTierV2,
  requiredTerrain: string,
  links: { progressesTo?: string; regressesTo?: string; alternativeFor?: string },
  vigilanceIds: readonly string[] = [],
  readTerrains: readonly string[] = [],
  origin: SessionDrillV2["origin"] = "v1_enriched"
): SessionDrillV2 {
  return {
    drillId,
    origin,
    skill,
    technicalTier,
    requiredTerrain,
    compatibleTerrains: [...new Set([requiredTerrain, ...readTerrains])],
    measureType: "pass",
    passes: { ...DH_DRILL_PASSES_RANGE_V2 },
    cueId: `cue.${drillId}`,
    criterionId: `criterion.${drillId}`,
    vigilanceIds,
    ...links,
    validationStatus: "PROVISIONAL",
  };
}

const SCOUT = "vigilance.dh_scout_first";
const PRECISION = "vigilance.dh_stop_on_precision_loss";
const JUMPS = "vigilance.dh_jumps_known_line";

/** INT-01 compatibility — terrain decisions of the later release (HPM P0 2026-10-12, P0-2 2026-10-13), read side only. */
const BERMED_TURN_TERRAINS = ["bermed_trail", "bike_park_jump_line", "full_dh_track"] as const;
const FULL_DH_TRACK = "full_dh_track";
const TURN_TERRAINS = [FULL_DH_TRACK, "any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line"] as const;

const ENTRIES: SessionDrillV2[] = [
  drill("braking_progressive_control", "braking", "beginner", "any_groomed_trail", { progressesTo: "braking_late_entry" }, [SCOUT], ["flow_trail", FULL_DH_TRACK]),
  drill("braking_late_entry", "braking", "intermediate", "flow_trail", { progressesTo: "braking_marked_zone_at_speed", regressesTo: "braking_progressive_control" }, [SCOUT], BERMED_TURN_TERRAINS),
  drill("braking_marked_zone_at_speed", "braking", "advanced", "technical_trail", { regressesTo: "braking_late_entry" }, [PRECISION], [FULL_DH_TRACK]),
  drill("cornering_flat_turn_precision", "cornering", "beginner", "flow_trail", { progressesTo: "cornering_berm_speed" }, [], [FULL_DH_TRACK]),
  drill("cornering_berm_speed", "cornering", "intermediate", "bermed_trail", { progressesTo: "cornering_off_camber", regressesTo: "cornering_flat_turn_precision" }, [], BERMED_TURN_TERRAINS),
  drill("cornering_off_camber", "cornering", "advanced", "technical_trail", { regressesTo: "cornering_berm_speed" }, [PRECISION], ["off_camber_section"]),
  // INT-01 compatibility — the later release's V2-only alternative of cornering_off_camber (P0-2, HPM option E,
  // draft texts): known so that a stored plan holding it reads, adapts and displays; never selected here.
  drill("cornering_advanced_line_exit", "cornering", "advanced", FULL_DH_TRACK, { regressesTo: "cornering_berm_speed", alternativeFor: "cornering_off_camber" }, [SCOUT, PRECISION], TURN_TERRAINS, "v2_only"),
  drill("line_choice_two_line_scan", "line_choice", "beginner", "technical_trail", { progressesTo: "line_choice_rock_garden" }, [SCOUT], [FULL_DH_TRACK]),
  drill("line_choice_rock_garden", "line_choice", "intermediate", "rock_garden", { progressesTo: "line_choice_fast_line_compare", regressesTo: "line_choice_two_line_scan" }, [SCOUT]),
  drill("line_choice_fast_line_compare", "line_choice", "advanced", "rock_garden", { regressesTo: "line_choice_rock_garden" }, [PRECISION]),
  drill("steep_terrain_controlled_roll_in", "steep_terrain", "beginner", "steep_technical_trail", { progressesTo: "steep_terrain_body_position" }, [SCOUT]),
  drill("steep_terrain_body_position", "steep_terrain", "intermediate", "steep_technical_trail", { progressesTo: "steep_terrain_off_brake_chute", regressesTo: "steep_terrain_controlled_roll_in" }, [SCOUT]),
  drill("steep_terrain_off_brake_chute", "steep_terrain", "advanced", "steep_technical_trail", { regressesTo: "steep_terrain_body_position" }, [PRECISION]),
  drill("roots_rocks_rolling", "roots_rocks", "beginner", "root_rock_trail", { progressesTo: "roots_rocks_unweighted_line" }),
  drill("roots_rocks_unweighted_line", "roots_rocks", "intermediate", "root_rock_trail", { progressesTo: "roots_rocks_committed", regressesTo: "roots_rocks_rolling" }),
  drill("roots_rocks_committed", "roots_rocks", "advanced", "root_rock_trail", { regressesTo: "roots_rocks_unweighted_line" }, [PRECISION]),
  drill("jumps_table_top_basic", "jumps", "beginner", "bike_park_jump_line", { progressesTo: "jumps_linked_tables" }, [JUMPS]),
  drill("jumps_linked_tables", "jumps", "intermediate", "bike_park_jump_line", { progressesTo: "jumps_step_down", regressesTo: "jumps_table_top_basic" }, [JUMPS]),
  drill("jumps_step_down", "jumps", "advanced", "bike_park_jump_line", { regressesTo: "jumps_linked_tables" }, [JUMPS]),
  drill("race_execution_section_consistency", "race_execution", "beginner", "any_groomed_trail", { progressesTo: "race_execution_split_pace" }, [], ["flow_trail", FULL_DH_TRACK]),
  drill("race_execution_split_pace", "race_execution", "intermediate", "technical_trail", { progressesTo: "race_execution_full_run_sim", regressesTo: "race_execution_section_consistency" }, [PRECISION], [FULL_DH_TRACK]),
  drill("race_execution_full_run_sim", "race_execution", "advanced", "full_dh_track", { regressesTo: "race_execution_split_pace" }, [PRECISION]),
];

export const SESSION_DRILL_CATALOG_V2_ENTRIES: readonly SessionDrillV2[] = ENTRIES;

export const SESSION_DRILL_CATALOG_V2: Readonly<Record<string, SessionDrillV2>> = Object.fromEntries(ENTRIES.map((d) => [d.drillId, d]));
