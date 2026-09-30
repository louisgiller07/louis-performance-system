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

export type CoachingTextKind = "cue" | "success_criterion" | "vigilance";

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
];

export const COACHING_TEXT_CATALOG_ENTRIES: readonly CoachingTextEntry[] = ENTRIES;

export const COACHING_TEXT_CATALOG: Readonly<Record<string, CoachingTextEntry>> = Object.fromEntries(
  ENTRIES.map((entry) => [entry.id, entry])
);
