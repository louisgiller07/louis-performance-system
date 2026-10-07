/**
 * UX-11A.5a.1 — canonical coaching text library (Session Model V2).
 *
 * The domain, not the web, is the source of truth for sport-facing text. A
 * V2 prescription stores ids (cueId, successCriterionId, vigilanceId,
 * later intentId), never free text generated on the fly. The web renders
 * these ids; its V1 translation tables (web/src/features/trainingLabels/)
 * are unrelated and unchanged.
 *
 * Canonical locale: fr-CH. `text` is a per-locale record so other locales
 * can be added without changing any id.
 *
 * Every entry is PROVISIONAL — coaching validation required: usable for
 * design, review and tests, never as validated sport content in
 * production (ADR UX-11A.5a.1). No entry may be marked VALIDATED without an
 * explicit external coaching validation.
 */

export const COACHING_TEXT_CATALOG_VERSION = "coaching-text-v1.0";

export type CoachingLocale = "fr-CH";
export const CANONICAL_COACHING_LOCALE: CoachingLocale = "fr-CH";

/** "PROVISIONAL" until an explicit external coaching validation; never inferred from V1 history. */
export type ContentValidationStatus = "PROVISIONAL" | "VALIDATED";
export const PROVISIONAL_NOTICE = "PROVISIONAL — coaching validation required";

/** Id prefixes: cue.*, criterion.* (success_criterion), vigilance.*, instruction.*, intent.* */
export type CoachingTextKind = "cue" | "success_criterion" | "vigilance" | "instruction" | "intent";

export interface CoachingTextEntry {
  id: string;
  kind: CoachingTextKind;
  text: Readonly<Record<CoachingLocale, string>>;
  validationStatus: ContentValidationStatus;
}

function cue(id: string, fr: string): CoachingTextEntry {
  return { id, kind: "cue", text: { "fr-CH": fr }, validationStatus: "PROVISIONAL" };
}

function vigilance(id: string, fr: string): CoachingTextEntry {
  return { id, kind: "vigilance", text: { "fr-CH": fr }, validationStatus: "PROVISIONAL" };
}

/** Describes ONE DH passage: never an aggregated threshold, never a stopwatch requirement. */
function criterion(id: string, fr: string): CoachingTextEntry {
  return { id, kind: "success_criterion", text: { "fr-CH": fr }, validationStatus: "PROVISIONAL" };
}

/**
 * Uncounted instruction of a DH session frame block or of a session protocol
 * block (UX-11A.5a.3): never a number of runs, never a digit — durations,
 * RPE and counts come from the structured template, not from the text.
 */
function instruction(id: string, fr: string): CoachingTextEntry {
  return { id, kind: "instruction", text: { "fr-CH": fr }, validationStatus: "PROVISIONAL" };
}

function intent(id: string, fr: string): CoachingTextEntry {
  return { id, kind: "intent", text: { "fr-CH": fr }, validationStatus: "PROVISIONAL" };
}

const ENTRIES: CoachingTextEntry[] = [
  // --- cues: squat / hinge ---
  cue("cue.bodyweight_squat", "Genoux dans l'axe des pieds, talons au sol."),
  cue("cue.goblet_squat", "Haltère contre la poitrine, descends entre les talons."),
  cue("cue.barbell_back_squat", "Gaine-toi avant la descente, remonte vite."),
  cue("cue.bodyweight_hip_hinge", "Dos neutre, hanches en arrière."),
  cue("cue.glute_bridge", "Pause d'une seconde en haut, côtes basses."),
  cue("cue.dumbbell_romanian_deadlift", "Dos neutre, sens l'étirement des ischios."),
  cue("cue.barbell_romanian_deadlift", "Barre près des jambes, hanches en arrière."),
  cue("cue.barbell_deadlift", "Pousse le sol, barre collée aux jambes."),
  cue("cue.dumbbell_hip_thrust", "Épaules sur le banc, verrouille les fessiers en haut."),
  // --- cues: unilateral / lower-leg prevention ---
  cue("cue.reverse_lunge", "Genou avant au-dessus du pied."),
  cue("cue.step_up", "Pousse avec la jambe du haut, sans élan."),
  cue("cue.bulgarian_split_squat", "Buste stable, genou dans l'axe."),
  cue("cue.single_leg_romanian_deadlift", "Bassin horizontal, dos neutre."),
  cue("cue.single_leg_calf_raise", "Monte lentement, pause en haut."),
  cue("cue.copenhagen_plank_short", "Genou sur le banc, corps aligné."),
  // --- cues: upper body ---
  cue("cue.floor_ytw_raise", "Pouces vers le haut, omoplates serrées."),
  cue("cue.band_pull_apart", "Bras tendus, omoplates serrées."),
  cue("cue.band_face_pull", "Coudes hauts, termine en rotation externe."),
  cue("cue.resistance_band_row", "Tire le coude vers la hanche."),
  cue("cue.inverted_row", "Corps gainé, poitrine vers la barre."),
  cue("cue.one_arm_dumbbell_row", "Tire sans tourner le buste."),
  cue("cue.lat_pulldown", "Tire les coudes vers les côtes."),
  cue("cue.pull_up", "Pars bras tendus, poitrine vers la barre."),
  cue("cue.pushup", "Corps gainé, coudes à 45°."),
  cue("cue.dumbbell_bench_press", "Omoplates serrées, descente contrôlée."),
  cue("cue.barbell_bench_press", "Omoplates serrées, pieds au sol."),
  cue("cue.half_kneeling_dumbbell_press", "Fessier serré, côtes basses."),
  // --- cues: grip / carry / core ---
  cue("cue.dead_hang", "Épaules engagées, respire."),
  cue("cue.farmer_carry", "Épaules basses, pas courts."),
  cue("cue.suitcase_carry", "Ne penche pas du côté de l'haltère."),
  cue("cue.plank", "Corps aligné, fessiers serrés."),
  cue("cue.side_plank", "Hanches hautes, corps aligné."),
  cue("cue.dead_bug", "Bas du dos collé au sol."),
  cue("cue.bird_dog", "Bassin immobile."),
  cue("cue.pallof_press", "Le buste ne tourne pas."),
  cue("cue.hanging_leg_raise", "Monte les jambes sans balancer."),
  cue("cue.bear_crawl", "Genoux proches du sol, dos plat."),
  // --- cues: power ---
  cue("cue.pogo_hops", "Contacts courts, genoux presque tendus."),
  cue("cue.squat_jump", "Saute haut, réception silencieuse, genoux dans l'axe."),
  cue("cue.broad_jump", "Tiens la réception deux secondes."),
  cue("cue.skater_jump", "Réception stable sur une jambe."),
  cue("cue.dumbbell_swing", "La hanche lance, les bras suivent."),
  cue("cue.plyo_pushup", "Pousse le sol vite, réception bras souples."),
  // --- cues: mobility / breathing (UX-11A.5a.3)
  cue("cue.hip_flexor_mobility", "Genou arrière au sol, bassin rentré, avance doucement les hanches sans cambrer."),
  cue("cue.thoracic_rotation_mobility", "Tourne depuis le haut du dos, bassin immobile, suis ta main du regard."),
  cue("cue.hip_90_90", "Buste droit, bascule lentement les genoux d'un côté puis de l'autre."),
  cue("cue.deep_squat_hold", "Talons au sol si possible, buste long ; tiens-toi à un appui si besoin."),
  cue("cue.knee_to_wall_ankle", "Talon au sol, amène le genou vers le mur dans l'axe du pied."),
  cue("cue.cat_cow", "Enroule puis creuse le dos lentement, au rythme de ta respiration."),
  cue("cue.worlds_greatest_stretch", "Grande fente, coude vers le pied avant, puis ouvre le bras vers le ciel."),
  cue("cue.wrist_mobility", "Cercles lents, puis appuis progressifs sur les mains."),
  cue("cue.breathing_long_exhale", "Inspire par le nez, puis expire lentement, plus longtemps que l'inspiration."),

  // --- vigilance (help, never a prohibition, never a medical decision) ---
  vigilance("vigilance.knee_pain_free_range", "Genou : garde une amplitude sans douleur."),
  vigilance("vigilance.back_stable_technique", "Dos : technique stable avant toute hausse de difficulté."),
  vigilance("vigilance.back_stop_before_rounding", "Dos : arrête la descente avant que le dos s'arrondisse."),
  vigilance("vigilance.balance_support_allowed", "Équilibre : tu peux te tenir à un appui au début."),
  vigilance("vigilance.achilles_pain_free", "Tendon d'Achille : reste sans douleur."),
  vigilance("vigilance.groin_stop_on_pain", "Aine : arrête en cas de douleur."),
  vigilance("vigilance.shoulder_pain_free", "Épaule : reste sans douleur."),
  vigilance("vigilance.wrist_thumb_stop_on_pain", "Poignet ou pouce : prise neutre possible, arrête en cas de douleur."),
  vigilance("vigilance.wrist_support_alternative", "Poignet : sur les poings ou des poignées si l'appui gêne."),
  vigilance("vigilance.grip_race_week", "Semaine de course : pas de travail lourd de préhension."),
  vigilance("vigilance.power_stop_on_quality_loss", "Arrête la série dès que la hauteur ou la vitesse baisse."),
  vigilance("vigilance.ankle_knee_landing", "Cheville et genou : réception stable avant d'enchaîner."),
  // mobility / breathing / endurance (UX-11A.5a.3) — descriptive, never a medical contraindication
  vigilance("vigilance.mobility_no_forced_range", "Amplitude : va jusqu'à une tension confortable, sans forcer ni rebondir."),
  vigilance("vigilance.wrist_gentle_load", "Poignet : mets du poids sur les mains progressivement, reste sans douleur."),
  vigilance("vigilance.breathing_normal_if_dizzy", "Si la tête te tourne, reprends une respiration normale."),

  // --- DH drills (UX-11A.5a.2a): one cue + one per-passage criterion each.
  // No number of passages in any text (the count comes from the
  // prescription), "passages" not "runs", a stopwatch is always optional.
  cue("cue.braking_progressive_control", "Serre les deux freins progressivement avant la zone marquée, sans les attraper d'un coup."),
  criterion("criterion.braking_progressive_control", "Vitesse contrôlée en douceur dans la zone de freinage, sans déraper."),
  cue("cue.braking_late_entry", "Garde les freins jusqu'à juste avant l'entrée du virage, puis engage-toi sur ta ligne sans retoucher aux freins."),
  criterion("criterion.braking_late_entry", "Vitesse d'entrée gardée plus loin dans le virage, sans élargir ta trajectoire."),
  cue("cue.braking_marked_zone_at_speed", "Marque une courte zone de freinage avant le passage technique : freine fort uniquement là, puis relâche et passe sans freiner."),
  criterion("criterion.braking_marked_zone_at_speed", "Freinage seulement dans la zone marquée, passage technique roulé sans freiner, à vitesse course."),
  cue("cue.cornering_flat_turn_precision", "Choisis le point de corde marqué avant l'entrée et fais passer ta roue avant dessus."),
  criterion("criterion.cornering_flat_turn_precision", "Roue avant à moins d'une longueur de vélo du point de corde marqué."),
  cue("cue.cornering_berm_speed", "Pédale extérieure en bas, charge tôt le virage relevé et garde ton poids appuyé dedans jusqu'à la sortie."),
  criterion("criterion.cornering_berm_speed", "Sortie du virage relevé plus rapide que l'entrée, sans rattraper une glisse."),
  cue("cue.cornering_off_camber", "Engage ton poids côté aval du vélo et continue dans la section en dévers, sans lâcher en plein virage."),
  criterion("criterion.cornering_off_camber", "Section en dévers passée sur ta ligne, sans pied posé."),
  cue("cue.line_choice_two_line_scan", "Arrête-toi au-dessus d'une courte section, choisis une des deux lignes et roule exactement celle-là à vitesse contrôlée ; prends l'autre au passage suivant."),
  criterion("criterion.line_choice_two_line_scan", "Ligne choisie avant l'entrée tenue du début à la sortie, à vitesse contrôlée."),
  cue("cue.line_choice_rock_garden", "Observe le pierrier de loin, annonce ta ligne à voix haute, puis engage-toi sans en changer."),
  criterion("criterion.line_choice_rock_garden", "Ligne annoncée avant l'entrée, puis tenue jusqu'à la sortie."),
  cue("cue.line_choice_fast_line_compare", "Roule le même pierrier sur deux lignes différentes à vitesse course, puis garde celle qui te paraît la plus rapide et la plus fluide. Le chrono est facultatif."),
  criterion("criterion.line_choice_fast_line_compare", "Ligne retenue tenue proprement à vitesse course, sans en changer en cours de section."),
  cue("cue.steep_terrain_controlled_roll_in", "Choisis une courte pente raide, règle une vitesse lente avant l'entrée, talons bas et poids en arrière, freins en douceur."),
  criterion("criterion.steep_terrain_controlled_roll_in", "Pente descendue à vitesse lente et régulière, sans déraper ni perdre l'avant."),
  cue("cue.steep_terrain_body_position", "Baisse les talons et recule ton poids à mesure que la pente se raidit, bras fléchis."),
  criterion("criterion.steep_terrain_body_position", "Poids centré ou en arrière selon la pente, sans perte de l'avant."),
  cue("cue.steep_terrain_off_brake_chute", "Casse ta vitesse avant le couloir, lâche les freins dans la partie la plus raide, talons bas, regard sur la sortie."),
  criterion("criterion.steep_terrain_off_brake_chute", "Partie la plus raide passée sans freiner et sans perte de l'avant."),
  cue("cue.roots_rocks_rolling", "Prise légère sur le guidon, laisse le vélo bouger sous toi ; ne freine plus une fois engagé."),
  criterion("criterion.roots_rocks_rolling", "Élan gardé sur toute la section, sans pied posé imprévu."),
  cue("cue.roots_rocks_unweighted_line", "Repère les plus grosses racines avant l'entrée, allège la roue avant sur chacune, pédales à l'horizontale."),
  criterion("criterion.roots_rocks_unweighted_line", "Section passée avec de l'élan, sans que l'avant dévie."),
  cue("cue.roots_rocks_committed", "Choisis ta ligne avant l'entrée et garde ta vitesse course jusqu'au bout."),
  criterion("criterion.roots_rocks_committed", "Section passée à une vitesse proche de la course, sur la ligne choisie."),
  cue("cue.jumps_table_top_basic", "Pédales à l'horizontale, pousse de façon égale sur le kick, absorbe la réception avec les genoux."),
  criterion("criterion.jumps_table_top_basic", "Décollage et réception propres, roues à plat."),
  cue("cue.jumps_linked_tables", "Enchaîne les table-tops sans pédaler, pompe chaque réception pour garder ta vitesse."),
  criterion("criterion.jumps_linked_tables", "Table-tops enchaînés, réceptions à plat, sans coup de frein."),
  cue("cue.jumps_step_down", "Adapte ton pop à la distance et repère la réception tôt ; engage-toi sur ta vitesse."),
  criterion("criterion.jumps_step_down", "Réception régulière et contrôlée, ni trop courte ni trop longue."),
  cue("cue.race_execution_section_consistency", "Choisis une courte section et roule-la à un rythme que tu peux répéter : même départ, même ligne, mêmes points de freinage. Si tu as un chrono, tes temps sont une observation facultative."),
  criterion("criterion.race_execution_section_consistency", "Même départ, même ligne et mêmes points de freinage que prévu, sans chute ni pied posé."),
  cue("cue.race_execution_split_pace", "Choisis une section technique avec un repère à mi-parcours et roule-la en mode course depuis un départ arrêté ; après chaque passage, repère la moitié la moins fluide et corrige-la au suivant. Le chrono est facultatif."),
  criterion("criterion.race_execution_split_pace", "Les deux moitiés roulées en mode course, sans relâcher dans la deuxième."),
  cue("cue.race_execution_full_run_sim", "Roule la piste complète en mode course, du départ à l'arrivée, en gardant tes lignes jusqu'en bas."),
  criterion("criterion.race_execution_full_run_sim", "Descente complète en mode course, sans relâcher en fin de piste."),

  // --- DH vigilance
  vigilance("vigilance.dh_scout_first", "Repère la section à vitesse réduite avant le premier passage."),
  vigilance("vigilance.dh_stop_on_precision_loss", "Arrête l'exercice si ta précision se dégrade nettement."),
  vigilance("vigilance.dh_jumps_known_line", "Sauts : seulement sur une ligne que tu connais et à ta portée."),

  // --- DH session frame instructions (uncounted blocks)
  instruction("instruction.dh.brief", "Relis l'objectif et la consigne de l'exercice avant ta première descente : aujourd'hui, la qualité compte plus que la vitesse."),
  instruction("instruction.dh.warm_up_easy", "Commence par des descentes faciles, sans chercher la vitesse, jusqu'à te sentir à l'aise sur le vélo."),
  instruction("instruction.dh.apply_cue", "Roule des descentes complètes en appliquant la consigne de l'exercice partout où elle s'applique. Le nombre de descentes dépend du terrain et de ton temps."),
  instruction("instruction.dh.debrief_and_check", "Termine par une descente facile, note ton ressenti sur l'exercice (facile, moyen, difficile) et contrôle rapidement ton vélo."),

  // --- session protocol instructions (UX-11A.5a.3, protocolCatalogV2.ts)
  instruction("instruction.endurance.activity_choice", "Choisis ton activité : vélo de route, VTT sur terrain roulant, home-trainer ou course à pied."),
  instruction("instruction.endurance.warm_up_easy", "Commence très facilement, puis augmente progressivement ton rythme."),
  instruction("instruction.endurance.talk_test_full_sentences", "Tu dois pouvoir parler en phrases complètes pendant tout l'effort."),
  instruction("instruction.endurance.cool_down_easy", "Termine à allure très facile pour revenir au calme."),
  instruction("instruction.endurance.intervals_work", "Pendant chaque répétition, tiens un effort soutenu et régulier, le même du début à la fin."),
  instruction("instruction.endurance.intervals_easy", "Entre les répétitions, continue très facilement pour récupérer."),
  instruction("instruction.mobility.slow_and_breathe", "Enchaîne les zones dans l'ordre, lentement, en respirant calmement."),
  instruction("instruction.recovery.very_easy_activity", "Choisis une activité très facile et garde ce rythme du début à la fin : cette séance ne doit pas ajouter de fatigue."),
  instruction("instruction.recovery.light_mobility", "Mobilité légère, sans chercher à gagner de l'amplitude."),
  instruction("instruction.strength_warm_up.mobility", "Mobilise les zones que ta séance va solliciter."),
  instruction("instruction.strength_warm_up.activation", "Active les muscles de ta séance, sans te fatiguer."),
  instruction("instruction.strength_warm_up.main_movement_ramp", "Avant tes séries de travail, fais une ou deux séries légères de ton mouvement principal, sans fatigue."),

  // --- intents (selected by intentCatalogV2.ts, never written on the fly)
  intent("intent.lower_body_strength_control", "Développer la force et la stabilité des jambes utiles au contrôle du vélo."),
  intent("intent.leg_strength_corner_exit", "Développer la force qui te permet de relancer après les compressions et en sortie de virage."),
  intent("intent.leg_stability_rough_terrain", "Construire la stabilité des jambes pour rester précis dans les terrains cassants."),
  intent("intent.upper_bike_control", "Construire la force du haut du corps qui stabilise le vélo."),
  intent("intent.grip_endurance_full_run", "Tenir le guidon jusqu'en bas de la piste."),
  intent("intent.strength_maintenance_light", "Entretenir ta force sans ajouter de fatigue."),
  intent("intent.corner_exit_power", "Développer la capacité à accélérer après les sorties de virage."),
  intent("intent.dh_braking_control", "Freiner au bon endroit pour garder ta vitesse."),
  intent("intent.dh_corner_exit_speed", "Sortir des virages avec plus de vitesse."),
  intent("intent.dh_line_reading", "Lire le terrain plus tôt et choisir ta ligne."),
  intent("intent.dh_steep_confidence", "Rester maître du vélo dans les pentes raides."),
  intent("intent.dh_rough_terrain_flow", "Laisser le vélo travailler dans les racines et les rochers."),
  intent("intent.dh_jump_control", "Contrôler tes sauts de l'appel à la réception."),
  intent("intent.dh_race_pace", "Tenir une allure de course du départ à l'arrivée."),
  // P0 replace stale copy — the race_execution intent of a drill without race intensity (section consistency).
  intent("intent.dh_race_consistency", "Répéter la section avec régularité : même ligne, mêmes repères."),
  intent("intent.aerobic_base_lucidity", "Développer ta base d'endurance pour rester lucide en fin de piste."),
  intent("intent.aerobic_repeat_efforts", "Répéter les efforts intenses sans t'éteindre."),
  intent("intent.mobility_on_bike_range", "Garder l'amplitude des hanches, des chevilles et du dos pour bouger sur le vélo."),
  intent("intent.recovery_without_fatigue", "Favoriser la récupération sans ajouter de fatigue."),
];

export const COACHING_TEXT_CATALOG_ENTRIES: readonly CoachingTextEntry[] = ENTRIES;

export const COACHING_TEXT_CATALOG: Readonly<Record<string, CoachingTextEntry>> = Object.fromEntries(
  ENTRIES.map((entry) => [entry.id, entry])
);
