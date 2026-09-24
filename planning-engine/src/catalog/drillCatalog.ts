/**
 * Versioned, code-based DH technical drill registry (M0 §6 / M1 §6). Small,
 * realistic V1 set — enough to represent the golden scenarios and prove the
 * model. DH-focused only, per V0.4 scope — no Enduro/Freeride drills.
 *
 * IDs are permanent — same rule as exerciseCatalog.ts.
 *
 * `executionCue` (V0.4_138) closes the prescription-engine blocker
 * identified V0.4_136/137: the catalogue is the sole source of truth for
 * this value, never generated/templated downstream. Distinct in
 * responsibility from `successCriteria` — execution guidance (what to do)
 * vs. success measurement (how to know it worked).
 *
 * PILOT_017 — complete skillTarget × difficulty coverage (7 × 3 = 21/21).
 * prescription-engine's selectDrill requires an exact difficulty match and
 * never falls back to another tier or priority (V0.4_124/126, unchanged), so
 * every combination needs its own entry. Each new entry reuses the terrain
 * already used by its skillTarget, or a common one, so it stays selectable
 * for a realistic DH terrain set.
 */

export const DRILL_CATALOG_VERSION = "v3";

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
  /** Short, action-oriented instruction for what to do during the drill — never derived from successCriteria/skillTarget/displayName, always authored directly. */
  executionCue: string;
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
    executionCue: "Squeeze both brakes progressively before each marked zone — never grab them in one motion.",
    progressesTo: "braking_late_entry",
  },
  {
    id: "braking_late_entry",
    displayName: "Late Braking, Early Release",
    skillTarget: "braking",
    terrainRequirement: "flow_trail",
    difficulty: "intermediate",
    successCriteria: "Maintains entry speed later into the corner without overshooting the line.",
    executionCue: "Delay brake release until just before the corner entry, then commit to the line without touching the brakes again.",
    progressesTo: "braking_marked_zone_at_speed",
    regressesTo: "braking_progressive_control",
  },
  {
    id: "braking_marked_zone_at_speed",
    displayName: "Braking Points at Race Speed",
    skillTarget: "braking",
    terrainRequirement: "technical_trail",
    difficulty: "advanced",
    successCriteria: "Brakes only in the marked zones and rides every technical feature off the brakes, at race speed, on 3/5 runs.",
    executionCue: "Mark one short braking zone before each technical feature — brake hard there only, then release fully and ride the feature off the brakes.",
    regressesTo: "braking_late_entry",
  },
  {
    id: "cornering_flat_turn_precision",
    displayName: "Flat Turn Line Precision",
    skillTarget: "cornering",
    terrainRequirement: "flow_trail",
    difficulty: "beginner",
    successCriteria: "Hits the marked apex within a bike length on 4/5 runs.",
    executionCue: "Pick the marked apex before entry and steer your front wheel through it every run.",
    progressesTo: "cornering_berm_speed",
  },
  {
    id: "cornering_berm_speed",
    displayName: "Berm Speed Carry",
    skillTarget: "cornering",
    terrainRequirement: "bermed_trail",
    difficulty: "intermediate",
    successCriteria: "Exits the berm faster than entry speed on 3/5 runs, no drift correction.",
    executionCue: "Load the berm early with your outside pedal down and drive weight into the wall through the exit.",
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
    executionCue: "Commit your weight into the low side of the bike and keep pedaling through the off-camber section — don't back off mid-turn.",
    regressesTo: "cornering_berm_speed",
  },
  {
    id: "line_choice_two_line_scan",
    displayName: "Two-Line Scan & Commit",
    skillTarget: "line_choice",
    terrainRequirement: "technical_trail",
    difficulty: "beginner",
    successCriteria: "Rides the line chosen before entry from start to exit, at controlled speed, on 4/5 runs.",
    executionCue: "Stop above a short technical section, pick one of two possible lines, then ride exactly that line at controlled speed — take the other line on the next run.",
    progressesTo: "line_choice_rock_garden",
  },
  {
    id: "line_choice_rock_garden",
    displayName: "Rock Garden Line Selection",
    skillTarget: "line_choice",
    terrainRequirement: "rock_garden",
    difficulty: "intermediate",
    successCriteria: "Calls the line out loud before entry and executes it on 4/5 runs.",
    executionCue: "Scan the rock garden from a distance, call your line out loud, then commit to it without changing mid-section.",
    progressesTo: "line_choice_fast_line_compare",
    regressesTo: "line_choice_two_line_scan",
  },
  {
    id: "line_choice_fast_line_compare",
    displayName: "Timed Fast-Line Comparison",
    skillTarget: "line_choice",
    terrainRequirement: "rock_garden",
    difficulty: "advanced",
    successCriteria: "Identifies the faster of two lines by timing, then repeats it cleanly at race speed on 3/5 runs.",
    executionCue: "Time the same rock garden on two different lines at race speed, then ride the faster one three runs in a row without changing it mid-section.",
    regressesTo: "line_choice_rock_garden",
  },
  {
    id: "steep_terrain_controlled_roll_in",
    displayName: "Controlled Steep Roll-In",
    skillTarget: "steep_terrain",
    terrainRequirement: "steep_technical_trail",
    difficulty: "beginner",
    successCriteria: "Rolls the pitch at a slow, steady speed without skidding or front-wheel wash on 4/5 runs.",
    executionCue: "Pick one short steep pitch, set a slow speed before the roll-in, then ride it heels down and weight back, braking smoothly with both brakes.",
    progressesTo: "steep_terrain_body_position",
  },
  {
    id: "steep_terrain_body_position",
    displayName: "Steep Terrain Body Position",
    skillTarget: "steep_terrain",
    terrainRequirement: "steep_technical_trail",
    difficulty: "intermediate",
    successCriteria: "Weight stays centered/rearward as required, no front-wheel wash, on 4/5 runs.",
    executionCue: "Drop your heels and shift weight rearward as the trail steepens — keep your arms bent, not locked out.",
    progressesTo: "steep_terrain_off_brake_chute",
    regressesTo: "steep_terrain_controlled_roll_in",
  },
  {
    id: "steep_terrain_off_brake_chute",
    displayName: "Steep Chute Off the Brakes",
    skillTarget: "steep_terrain",
    terrainRequirement: "steep_technical_trail",
    difficulty: "advanced",
    successCriteria: "Rides the steepest part of the chute off the brakes, with no front-wheel wash, on 3/5 runs.",
    executionCue: "Scrub speed before the chute, release the brakes through the steepest part and let the bike run out at the bottom — heels down, eyes on the exit.",
    regressesTo: "steep_terrain_body_position",
  },
  {
    id: "roots_rocks_rolling",
    displayName: "Rolling Roots & Rocks",
    skillTarget: "roots_rocks",
    terrainRequirement: "root_rock_trail",
    difficulty: "beginner",
    successCriteria: "Maintains momentum through the section without unplanned dabs on 4/5 runs.",
    executionCue: "Keep a light grip and let the bike move under you — stay off the brakes once you commit to the section.",
    progressesTo: "roots_rocks_committed",
  },
  {
    id: "roots_rocks_unweighted_line",
    displayName: "Unweighted Roots & Rocks Line",
    skillTarget: "roots_rocks",
    terrainRequirement: "root_rock_trail",
    difficulty: "intermediate",
    successCriteria: "Clears the section with momentum and no front-wheel deflection on 4/5 runs.",
    executionCue: "Spot the biggest roots and rocks before entry, lighten the front wheel over each one with a small push of the hips, and keep your pedals level through the section.",
    progressesTo: "roots_rocks_committed",
    regressesTo: "roots_rocks_rolling",
  },
  {
    id: "roots_rocks_committed",
    displayName: "Committed Roots & Rocks at Speed",
    skillTarget: "roots_rocks",
    terrainRequirement: "root_rock_trail",
    difficulty: "advanced",
    successCriteria: "Clears the section at race-relevant speed on 3/5 runs.",
    executionCue: "Pick your line before entry and carry race-pace speed through — trust the bike to track over the roots.",
    regressesTo: "roots_rocks_rolling",
  },
  {
    id: "jumps_table_top_basic",
    displayName: "Table Top Basics",
    skillTarget: "jumps",
    terrainRequirement: "bike_park_jump_line",
    difficulty: "beginner",
    successCriteria: "Clean take-off and landing, wheels level, on 4/5 runs.",
    executionCue: "Keep your pedals level and push evenly through the lip — absorb the landing with bent knees, not your back.",
    progressesTo: "jumps_step_down",
  },
  {
    id: "jumps_linked_tables",
    displayName: "Linked Table Tops",
    skillTarget: "jumps",
    terrainRequirement: "bike_park_jump_line",
    difficulty: "intermediate",
    successCriteria: "Clears two or three tables in a row with level landings and no speed-check braking on 3/5 runs.",
    executionCue: "Ride two or three tables in a row without pedaling between them — pump each landing to carry speed into the next take-off.",
    progressesTo: "jumps_step_down",
    regressesTo: "jumps_table_top_basic",
  },
  {
    id: "jumps_step_down",
    displayName: "Step-Down Confidence",
    skillTarget: "jumps",
    terrainRequirement: "bike_park_jump_line",
    difficulty: "advanced",
    successCriteria: "Consistent, controlled landing on 3/5 runs, no case/overshoot.",
    executionCue: "Match your pop to the gap size and spot the landing early — commit to the speed, don't back off in the air.",
    regressesTo: "jumps_table_top_basic",
  },
  {
    id: "race_execution_section_consistency",
    displayName: "Timed Section Consistency",
    skillTarget: "race_execution",
    terrainRequirement: "any_groomed_trail",
    difficulty: "beginner",
    successCriteria: "All timed runs of the section within 2 seconds of each other, with no crash or foot-down.",
    executionCue: "Time 3 to 5 runs of the same short section at a pace you can repeat — same start, same line, same braking points every run.",
    progressesTo: "race_execution_split_pace",
  },
  {
    id: "race_execution_split_pace",
    displayName: "Race-Pace Split Run",
    skillTarget: "race_execution",
    terrainRequirement: "technical_trail",
    difficulty: "intermediate",
    successCriteria: "Rides the section at race intent with both splits within 3% of the best run on 2/3 runs.",
    executionCue: "Mark a 1–2 minute technical section with a midway split, ride it at race intent from a standing start, then compare the two splits and repeat, fixing the slower half.",
    progressesTo: "race_execution_full_run_sim",
    regressesTo: "race_execution_section_consistency",
  },
  {
    id: "race_execution_full_run_sim",
    displayName: "Full Run Race Simulation",
    skillTarget: "race_execution",
    terrainRequirement: "full_dh_track",
    difficulty: "advanced",
    successCriteria: "Completes a full timed run within a declared target margin of best practice time.",
    executionCue: "Ride the full track at race intent from the first gate to the finish line — treat every section like it counts.",
    regressesTo: "race_execution_split_pace",
  },
];

/** Raw entry list, preserved separately from the id-keyed record below — see exerciseCatalog.ts's identical note. */
export const DRILL_CATALOG_ENTRIES: readonly DrillCatalogEntry[] = ENTRIES;

export const DRILL_CATALOG: Readonly<Record<string, DrillCatalogEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry]))
);
