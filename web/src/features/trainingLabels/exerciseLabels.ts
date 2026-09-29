// REV-015.3 — athlete-facing French names for strength exercises and DH
// drills, keyed by catalogue id. Stored prescriptions carry only the id
// (training_plan_planned_prescriptions.structure: blocks[].exerciseId /
// drills[].drillId — never a name), and no id has ever been renamed or
// removed from the catalogue, so this table also covers every existing plan.
// Presentation only: the engine catalogue (planning-engine/src/catalog,
// v3: 21 exercises, 21 drills) and the stored data are never changed.
//
// Product decision (REV-015.3): translate, except sport terms in common
// French use with no established equivalent — "Goblet squat", "Pallof
// press", "Y-T-W", "table-top", "step-down", "run".
//
// Unknown/empty ids return `null` — callers fall back to UNKNOWN_EXERCISE_LABEL
// / UNKNOWN_DRILL_LABEL, never to the raw id.

export const UNKNOWN_EXERCISE_LABEL = "Exercice";
export const UNKNOWN_DRILL_LABEL = "Exercice technique";

export const EXERCISE_LABELS: Readonly<Record<string, string>> = {
  bodyweight_squat: "Squat au poids du corps",
  goblet_squat: "Goblet squat",
  barbell_back_squat: "Squat arrière à la barre",
  bodyweight_hip_hinge: "Flexion de hanches au poids du corps",
  dumbbell_romanian_deadlift: "Soulevé de terre roumain aux haltères",
  barbell_deadlift: "Soulevé de terre à la barre",
  pushup: "Pompes",
  dumbbell_bench_press: "Développé couché aux haltères",
  barbell_bench_press: "Développé couché à la barre",
  floor_ytw_raise: "Élévations Y-T-W au sol",
  resistance_band_row: "Tirage à l'élastique",
  lat_pulldown: "Tirage vertical à la poulie",
  pull_up: "Tractions",
  bear_crawl: "Marche de l'ours",
  farmer_carry: "Marche du fermier",
  suitcase_carry: "Marche valise (un bras)",
  plank: "Gainage (planche)",
  pallof_press: "Pallof press",
  hanging_leg_raise: "Relevés de jambes suspendu",
  hip_flexor_mobility: "Mobilité des fléchisseurs de hanche",
  thoracic_rotation_mobility: "Mobilité thoracique en rotation",
};

export const DRILL_LABELS: Readonly<Record<string, string>> = {
  braking_progressive_control: "Freinage progressif",
  braking_late_entry: "Freinage tardif, relâchement précoce",
  braking_marked_zone_at_speed: "Points de freinage à vitesse de course",
  cornering_flat_turn_precision: "Précision de trajectoire en virage plat",
  cornering_berm_speed: "Garder la vitesse dans les virages relevés",
  cornering_off_camber: "Engagement en virage en dévers",
  line_choice_two_line_scan: "Repérer deux lignes et s'engager",
  line_choice_rock_garden: "Choix de ligne dans le pierrier",
  line_choice_fast_line_compare: "Comparaison chronométrée des lignes",
  steep_terrain_controlled_roll_in: "Entrée contrôlée en pente raide",
  steep_terrain_body_position: "Position du corps en pente raide",
  steep_terrain_off_brake_chute: "Couloir raide sans freiner",
  roots_rocks_rolling: "Rouler sur racines et rochers",
  roots_rocks_unweighted_line: "Ligne délestée sur racines et rochers",
  roots_rocks_committed: "Racines et rochers engagés, à vitesse",
  jumps_table_top_basic: "Bases des table-tops",
  jumps_linked_tables: "Enchaîner les table-tops",
  jumps_step_down: "Confiance sur les step-downs",
  race_execution_section_consistency: "Régularité chronométrée par section",
  race_execution_split_pace: "Run fractionné à allure course",
  race_execution_full_run_sim: "Simulation de run complet",
};

/** Own keys only — an inherited name ("toString", "constructor") never matches. */
function ownLabel(table: Readonly<Record<string, string>>, value: unknown): string | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value) ? table[value]! : null;
}

export function translateExercise(exerciseId: unknown): string | null {
  return ownLabel(EXERCISE_LABELS, exerciseId);
}

export function translateDrill(drillId: unknown): string | null {
  return ownLabel(DRILL_LABELS, drillId);
}
