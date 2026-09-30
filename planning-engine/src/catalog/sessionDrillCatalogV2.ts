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
  origin: "v1_enriched";
  skill: DhSkillV2;
  /** The drill's own difficulty, matched later against the rider's declared dhTechnicalTier. */
  technicalTier: DhTechnicalTierV2;
  requiredTerrain: string;
  measureType: "passes";
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
  links: { progressesTo?: string; regressesTo?: string },
  vigilanceIds: readonly string[] = []
): SessionDrillV2 {
  return {
    drillId,
    origin: "v1_enriched",
    skill,
    technicalTier,
    requiredTerrain,
    measureType: "passes",
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

const ENTRIES: SessionDrillV2[] = [
  drill("braking_progressive_control", "braking", "beginner", "any_groomed_trail", { progressesTo: "braking_late_entry" }, [SCOUT]),
  drill("braking_late_entry", "braking", "intermediate", "flow_trail", { progressesTo: "braking_marked_zone_at_speed", regressesTo: "braking_progressive_control" }, [SCOUT]),
  drill("braking_marked_zone_at_speed", "braking", "advanced", "technical_trail", { regressesTo: "braking_late_entry" }, [PRECISION]),
  drill("cornering_flat_turn_precision", "cornering", "beginner", "flow_trail", { progressesTo: "cornering_berm_speed" }),
  drill("cornering_berm_speed", "cornering", "intermediate", "bermed_trail", { progressesTo: "cornering_off_camber", regressesTo: "cornering_flat_turn_precision" }),
  drill("cornering_off_camber", "cornering", "advanced", "technical_trail", { regressesTo: "cornering_berm_speed" }, [PRECISION]),
  drill("line_choice_two_line_scan", "line_choice", "beginner", "technical_trail", { progressesTo: "line_choice_rock_garden" }, [SCOUT]),
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
  drill("race_execution_section_consistency", "race_execution", "beginner", "any_groomed_trail", { progressesTo: "race_execution_split_pace" }),
  drill("race_execution_split_pace", "race_execution", "intermediate", "technical_trail", { progressesTo: "race_execution_full_run_sim", regressesTo: "race_execution_section_consistency" }, [PRECISION]),
  drill("race_execution_full_run_sim", "race_execution", "advanced", "full_dh_track", { regressesTo: "race_execution_split_pace" }, [PRECISION]),
];

export const SESSION_DRILL_CATALOG_V2_ENTRIES: readonly SessionDrillV2[] = ENTRIES;

export const SESSION_DRILL_CATALOG_V2: Readonly<Record<string, SessionDrillV2>> = Object.fromEntries(ENTRIES.map((d) => [d.drillId, d]));
