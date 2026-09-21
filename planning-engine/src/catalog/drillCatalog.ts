/**
 * Versioned, code-based DH technical drill registry (M0 §6 / M1 §6). Small,
 * realistic V1 set — enough to represent the golden scenarios and prove the
 * model. DH-focused only, per V0.4 scope — no Enduro/Freeride drills.
 *
 * IDs are permanent — same rule as exerciseCatalog.ts.
 */

export const DRILL_CATALOG_VERSION = "v1";

export type DrillDifficultyTier = "beginner" | "intermediate" | "advanced";

export interface DrillCatalogEntry {
  id: string;
  displayName: string;
  /** Closed vocabulary — matches PlanInputTechnicalPriorities' vocabulary (planInputSnapshot.ts) and DhDrill.skillTarget. */
  skillTarget: string;
  /** Closed vocabulary — matches PlanInputSnapshot.terrainAccess's vocabulary. */
  terrainRequirement: string;
  difficulty: DrillDifficultyTier;
  successCriteria: string;
  progressesTo?: string;
  regressesTo?: string;
  deprecated?: boolean;
  replacedBy?: string;
}

const ENTRIES: DrillCatalogEntry[] = [
  {
    id: "braking_progressive_control",
    displayName: "Progressive Braking Control",
    skillTarget: "braking",
    terrainRequirement: "any_groomed_trail",
    difficulty: "beginner",
    successCriteria: "Speed controlled smoothly into every marked braking zone, no skidding.",
    progressesTo: "braking_late_entry",
  },
  {
    id: "braking_late_entry",
    displayName: "Late Braking, Early Release",
    skillTarget: "braking",
    terrainRequirement: "flow_trail",
    difficulty: "intermediate",
    successCriteria: "Maintains entry speed later into the corner without overshooting the line.",
    regressesTo: "braking_progressive_control",
  },
  {
    id: "cornering_flat_turn_precision",
    displayName: "Flat Turn Line Precision",
    skillTarget: "cornering",
    terrainRequirement: "flow_trail",
    difficulty: "beginner",
    successCriteria: "Hits the marked apex within a bike length on 4/5 runs.",
    progressesTo: "cornering_berm_speed",
  },
  {
    id: "cornering_berm_speed",
    displayName: "Berm Speed Carry",
    skillTarget: "cornering",
    terrainRequirement: "bermed_trail",
    difficulty: "intermediate",
    successCriteria: "Exits the berm faster than entry speed on 3/5 runs, no drift correction.",
    progressesTo: "cornering_off_camber",
    regressesTo: "cornering_flat_turn_precision",
  },
  {
    id: "cornering_off_camber",
    displayName: "Off-Camber Turn Commitment",
    skillTarget: "cornering",
    terrainRequirement: "technical_trail",
    difficulty: "advanced",
    successCriteria: "Completes the off-camber section on line, without a foot-down, on 3/5 runs.",
    regressesTo: "cornering_berm_speed",
  },
  {
    id: "line_choice_rock_garden",
    displayName: "Rock Garden Line Selection",
    skillTarget: "line_choice",
    terrainRequirement: "rock_garden",
    difficulty: "intermediate",
    successCriteria: "Calls the line out loud before entry and executes it on 4/5 runs.",
  },
  {
    id: "steep_terrain_body_position",
    displayName: "Steep Terrain Body Position",
    skillTarget: "steep_terrain",
    terrainRequirement: "steep_technical_trail",
    difficulty: "intermediate",
    successCriteria: "Weight stays centered/rearward as required, no front-wheel wash, on 4/5 runs.",
  },
  {
    id: "roots_rocks_rolling",
    displayName: "Rolling Roots & Rocks",
    skillTarget: "roots_rocks",
    terrainRequirement: "root_rock_trail",
    difficulty: "beginner",
    successCriteria: "Maintains momentum through the section without unplanned dabs on 4/5 runs.",
    progressesTo: "roots_rocks_committed",
  },
  {
    id: "roots_rocks_committed",
    displayName: "Committed Roots & Rocks at Speed",
    skillTarget: "roots_rocks",
    terrainRequirement: "root_rock_trail",
    difficulty: "advanced",
    successCriteria: "Clears the section at race-relevant speed on 3/5 runs.",
    regressesTo: "roots_rocks_rolling",
  },
  {
    id: "jumps_table_top_basic",
    displayName: "Table Top Basics",
    skillTarget: "jumps",
    terrainRequirement: "bike_park_jump_line",
    difficulty: "beginner",
    successCriteria: "Clean take-off and landing, wheels level, on 4/5 runs.",
    progressesTo: "jumps_step_down",
  },
  {
    id: "jumps_step_down",
    displayName: "Step-Down Confidence",
    skillTarget: "jumps",
    terrainRequirement: "bike_park_jump_line",
    difficulty: "advanced",
    successCriteria: "Consistent, controlled landing on 3/5 runs, no case/overshoot.",
    regressesTo: "jumps_table_top_basic",
  },
  {
    id: "race_execution_full_run_sim",
    displayName: "Full Run Race Simulation",
    skillTarget: "race_execution",
    terrainRequirement: "full_dh_track",
    difficulty: "advanced",
    successCriteria: "Completes a full timed run within a declared target margin of best practice time.",
  },
];

/** Raw entry list, preserved separately from the id-keyed record below — see exerciseCatalog.ts's identical note. */
export const DRILL_CATALOG_ENTRIES: readonly DrillCatalogEntry[] = ENTRIES;

export const DRILL_CATALOG: Readonly<Record<string, DrillCatalogEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry]))
);
