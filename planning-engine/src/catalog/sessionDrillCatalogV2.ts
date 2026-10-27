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
 *   P0-2 (HPM 2026-10-13): one exception, cornering_off_camber (reference terrain =
 *   the declared off-camber section), and one V2-only drill, cornering_advanced_line_exit
 *   (the explicit alternative of cornering_off_camber). Content added without a version
 *   change (strictly additive, ADR P0 REPLACE STALE COPY precedent): every stored id and
 *   text keeps its meaning.
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
  /** "v1_enriched": one of the 21 V1 drills; "v2_only": added by V2 (P0-2), no V1 counterpart. */
  origin: "v1_enriched" | "v2_only";
  skill: DhSkillV2;
  /** The drill's own difficulty, matched later against the rider's declared dhTechnicalTier. */
  technicalTier: DhTechnicalTierV2;
  /**
   * The drill's reference terrain, also the first compatible terrain: the V1 terrainRequirement, except
   * cornering_off_camber (P0-2, HPM 2026-10-13: the off-camber section declared by the rider).
   */
  requiredTerrain: string;
  /**
   * P0 first generation (HPM 2026-10-12) — every terrain on which the drill's validated texts can be
   * ridden as written; a rider who declared ANY of them can receive the drill. Always starts with
   * requiredTerrain. Selection data only: never shown, never changes which drill a (skill, tier) gets.
   */
  compatibleTerrains: readonly string[];
  // UX-11B.2.3 — single measure vocabulary with recorded sets: "pass", never "passes".
  measureType: "pass";
  passes: { min: number; max: number };
  cueId: string;
  criterionId: string;
  vigilanceIds: readonly string[];
  progressesTo?: string;
  regressesTo?: string;
  /**
   * P0-2 (HPM 2026-10-13, option E) — set on the ONE explicit alternative of a (skill, tier) reference drill:
   * the drill id it stands in for. Selected only when the rider declared no terrain of the reference drill
   * and at least one of its own (selectDhDrill); same skill, same tier, never a race-intensity drill.
   */
  alternativeFor?: string;
  validationStatus: ContentValidationStatus;
}

/**
 * HPM 2026-10-12 (rider feedback, NALYNT V1): these terrains give the rider access to bermed turns —
 * not every turn is bermed, but berms are available for the drills. Deliberately NOT extended to
 * technical_trail or root_rock_trail. A flow trail counts as a groomed trail (HPM 2026-10-12, final decision),
 * applied only to braking_progressive_control.
 */
export const BERMED_TURN_TERRAINS_V1 = ["bermed_trail", "bike_park_jump_line", "full_dh_track"] as const;

/**
 * P0-2 (HPM 2026-10-13) — a full DH track hosts the general trajectory, braking and control drills
 * without artificially requiring a technical trail. It does NOT guarantee an off-camber section, a
 * particularly steep section, roots, rocks, a rock garden, jumps or another specific obstacle: those
 * drills keep their specific terrain (HPM final decision: off-camber and steep drills included).
 */
const FULL_DH_TRACK = "full_dh_track";

/**
 * P0-2 (HPM 2026-10-13) — an off-camber section is a feature, confirmed only by the rider declaring it
 * (optional terrain choice « Virages en dévers »). A technical trail alone does not confirm one.
 */
export const OFF_CAMBER_SECTION = "off_camber_section";

/**
 * P0-2 — terrains on which a turn is available to the general advanced cornering drill: every trail or
 * track the rider can declare. Not a rock garden (a section) nor the off-camber feature itself.
 */
const TURN_TERRAINS_V2 = [FULL_DH_TRACK, "any_groomed_trail", "flow_trail", "bermed_trail", "technical_trail", "steep_technical_trail", "root_rock_trail", "bike_park_jump_line"] as const;

function drill(
  drillId: string,
  skill: DhSkillV2,
  technicalTier: DhTechnicalTierV2,
  terrains: string | readonly string[],
  links: { progressesTo?: string; regressesTo?: string; alternativeFor?: string },
  vigilanceIds: readonly string[] = [],
  origin: SessionDrillV2["origin"] = "v1_enriched"
): SessionDrillV2 {
  const compatibleTerrains = typeof terrains === "string" ? [terrains] : [...new Set(terrains)];
  return {
    drillId,
    origin,
    skill,
    technicalTier,
    requiredTerrain: compatibleTerrains[0]!,
    compatibleTerrains,
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

const ENTRIES: SessionDrillV2[] = [
  // P0 — HPM 2026-10-12: a flow trail is a groomed trail (NALYNT V1); the texts need only a rider-marked braking zone.
  // P0-2 — a rider-marked braking zone exists on a full DH track too.
  drill("braking_progressive_control", "braking", "beginner", ["any_groomed_trail", "flow_trail", FULL_DH_TRACK], { progressesTo: "braking_late_entry" }, [SCOUT]),
  // P0 — its texts need a turn entry (« juste avant l'entrée du virage »): the bermed-turn terrains have turns.
  drill("braking_late_entry", "braking", "intermediate", ["flow_trail", ...BERMED_TURN_TERRAINS_V1], { progressesTo: "braking_marked_zone_at_speed", regressesTo: "braking_progressive_control" }, [SCOUT]),
  // P0-2 — « avant le passage technique »: any technical passage, which a full DH track has.
  drill("braking_marked_zone_at_speed", "braking", "advanced", ["technical_trail", FULL_DH_TRACK], { regressesTo: "braking_late_entry" }, [PRECISION]),
  // P0-2 — a marked apex on a turn: a trajectory drill, rideable on the turns of a full DH track.
  drill("cornering_flat_turn_precision", "cornering", "beginner", ["flow_trail", FULL_DH_TRACK], { progressesTo: "cornering_berm_speed" }),
  // P0 — its texts need a bermed turn (« virage relevé »): the bermed-turn terrains (HPM 2026-10-12).
  drill("cornering_berm_speed", "cornering", "intermediate", BERMED_TURN_TERRAINS_V1, { progressesTo: "cornering_off_camber", regressesTo: "cornering_flat_turn_precision" }),
  // P0-2 (HPM 2026-10-13) — only where an off-camber section is confirmed by the rider: neither a technical trail
  // (V1 reference terrain) nor a full DH track guarantees one. Its texts stay PROVISIONAL (coach review).
  drill("cornering_off_camber", "cornering", "advanced", OFF_CAMBER_SECTION, { regressesTo: "cornering_berm_speed" }, [PRECISION]),
  // P0-2 (HPM option E) — the explicit alternative of cornering_off_camber: line, braking marks and exit quality on
  // any available turn, without an off-camber section or a berm. Draft texts, PROVISIONAL.
  drill("cornering_advanced_line_exit", "cornering", "advanced", TURN_TERRAINS_V2, { regressesTo: "cornering_berm_speed", alternativeFor: "cornering_off_camber" }, [SCOUT, PRECISION], "v2_only"),
  // P0-2 — two lines through a short section: a general trajectory drill, rideable on a full DH track.
  drill("line_choice_two_line_scan", "line_choice", "beginner", ["technical_trail", FULL_DH_TRACK], { progressesTo: "line_choice_rock_garden" }, [SCOUT]),
  drill("line_choice_rock_garden", "line_choice", "intermediate", "rock_garden", { progressesTo: "line_choice_fast_line_compare", regressesTo: "line_choice_two_line_scan" }, [SCOUT]),
  drill("line_choice_fast_line_compare", "line_choice", "advanced", "rock_garden", { regressesTo: "line_choice_rock_garden" }, [PRECISION]),
  // P0-2 (HPM final decision) — the steep drills need a particularly steep section: steep technical trail only.
  drill("steep_terrain_controlled_roll_in", "steep_terrain", "beginner", "steep_technical_trail", { progressesTo: "steep_terrain_body_position" }, [SCOUT]),
  drill("steep_terrain_body_position", "steep_terrain", "intermediate", "steep_technical_trail", { progressesTo: "steep_terrain_off_brake_chute", regressesTo: "steep_terrain_controlled_roll_in" }, [SCOUT]),
  drill("steep_terrain_off_brake_chute", "steep_terrain", "advanced", "steep_technical_trail", { regressesTo: "steep_terrain_body_position" }, [PRECISION]),
  drill("roots_rocks_rolling", "roots_rocks", "beginner", "root_rock_trail", { progressesTo: "roots_rocks_unweighted_line" }),
  drill("roots_rocks_unweighted_line", "roots_rocks", "intermediate", "root_rock_trail", { progressesTo: "roots_rocks_committed", regressesTo: "roots_rocks_rolling" }),
  drill("roots_rocks_committed", "roots_rocks", "advanced", "root_rock_trail", { regressesTo: "roots_rocks_unweighted_line" }, [PRECISION]),
  drill("jumps_table_top_basic", "jumps", "beginner", "bike_park_jump_line", { progressesTo: "jumps_linked_tables" }, [JUMPS]),
  drill("jumps_linked_tables", "jumps", "intermediate", "bike_park_jump_line", { progressesTo: "jumps_step_down", regressesTo: "jumps_table_top_basic" }, [JUMPS]),
  drill("jumps_step_down", "jumps", "advanced", "bike_park_jump_line", { regressesTo: "jumps_linked_tables" }, [JUMPS]),
  // P0-2 — HPM decision: a short, repeatable section at controlled pace — a flow trail or a full DH track has one.
  drill("race_execution_section_consistency", "race_execution", "beginner", ["any_groomed_trail", "flow_trail", FULL_DH_TRACK], { progressesTo: "race_execution_split_pace" }),
  // P0-2 — « une section technique avec un repère à mi-parcours »: a full DH track has technical sections.
  drill("race_execution_split_pace", "race_execution", "intermediate", ["technical_trail", FULL_DH_TRACK], { progressesTo: "race_execution_full_run_sim", regressesTo: "race_execution_section_consistency" }, [PRECISION]),
  drill("race_execution_full_run_sim", "race_execution", "advanced", "full_dh_track", { regressesTo: "race_execution_split_pace" }, [PRECISION]),
];

export const SESSION_DRILL_CATALOG_V2_ENTRIES: readonly SessionDrillV2[] = ENTRIES;

export const SESSION_DRILL_CATALOG_V2: Readonly<Record<string, SessionDrillV2>> = Object.fromEntries(ENTRIES.map((d) => [d.drillId, d]));

/**
 * V2-DH-SPORT-GATE-01B (HPM 2026-10-26) — the name displayed for each drill (fr-CH), exactly as the web serves it today
 * (trainingLabels DRILL_LABELS, and the V2-only name). It is part of the content signed in C (dhSportGateV2): a name
 * changed after signing closes the drill's gate. The web's V2 drill name (drillNameV2) is pinned to it by test.
 * PROVISIONAL — product wording, same status as the web labels.
 */
export const SESSION_DRILL_NAMES_V2: Readonly<Record<string, string>> = Object.freeze({
  braking_progressive_control: "Freinage progressif",
  braking_late_entry: "Freinage tardif, relâchement précoce",
  braking_marked_zone_at_speed: "Points de freinage marqués",
  cornering_flat_turn_precision: "Précision de trajectoire en virage plat",
  cornering_berm_speed: "Garder la vitesse dans les virages relevés",
  cornering_off_camber: "Engagement en virage en dévers",
  cornering_advanced_line_exit: "Trajectoire et sortie de virage",
  line_choice_two_line_scan: "Repérer deux lignes et s'engager",
  line_choice_rock_garden: "Choix de ligne dans le pierrier",
  line_choice_fast_line_compare: "Comparaison chronométrée des lignes",
  steep_terrain_controlled_roll_in: "Entrée contrôlée en pente raide",
  steep_terrain_body_position: "Position du corps en pente raide",
  steep_terrain_off_brake_chute: "Couloir raide, freinage dosé",
  roots_rocks_rolling: "Rouler sur racines et rochers",
  roots_rocks_unweighted_line: "Ligne délestée sur racines et rochers",
  roots_rocks_committed: "Racines et rochers, ligne engagée",
  jumps_table_top_basic: "Bases des table-tops",
  jumps_linked_tables: "Enchaîner les table-tops",
  jumps_step_down: "Confiance sur les step-downs",
  race_execution_section_consistency: "Régularité chronométrée par section",
  race_execution_split_pace: "Run fractionné à allure course",
  race_execution_full_run_sim: "Simulation de run complet",
});
