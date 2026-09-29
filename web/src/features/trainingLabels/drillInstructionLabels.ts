// REV-015.4b — athlete-facing French for DH drill instructions
// (executionCue) and success criteria (successCriterion). Wording from the
// REV-015.4a validated dictionary.
//
// Unlike exercise/drill names, these texts are copied into every stored
// prescription at generation time (prescription-engine dhResolver →
// training_plan_planned_prescriptions.structure.drills[]), so the stored
// English is what reaches the screen. A translation is therefore applied
// only when BOTH the drillId is known AND the stored text is exactly the
// English source it was written for: if the engine catalogue ever changes a
// text, older plans keep their older English and are never shown a
// translation of a different sentence. In that case — or for an unknown
// drill — the stored original text is kept: a coaching instruction is never
// dropped. Presentation only: the engine catalogue and stored data are
// never changed. A test keeps every `source*` field equal to the engine
// catalogue (planning-engine/src/catalog/drillCatalog.ts, v3).

interface DrillInstructionTranslation {
  sourceExecutionCue: string;
  executionCue: string;
  sourceSuccessCriterion: string;
  successCriterion: string;
}

export const DRILL_INSTRUCTION_LABELS: Readonly<Record<string, DrillInstructionTranslation>> = {
  braking_progressive_control: {
    sourceExecutionCue: "Squeeze both brakes progressively before each marked zone — never grab them in one motion.",
    executionCue: "Serre les deux freins progressivement avant chaque zone marquée — ne les attrape jamais d'un coup.",
    sourceSuccessCriterion: "Speed controlled smoothly into every marked braking zone, no skidding.",
    successCriterion: "Tu contrôles ta vitesse en douceur dans chaque zone de freinage marquée, sans déraper.",
  },
  // TODO(REV-015.4a): coach DH validation recommended — "delay brake release" means keep braking, then release just before corner entry.
  braking_late_entry: {
    sourceExecutionCue: "Delay brake release until just before the corner entry, then commit to the line without touching the brakes again.",
    executionCue: "Garde les freins jusqu'à juste avant l'entrée du virage, puis engage-toi sur ta ligne sans retoucher aux freins.",
    sourceSuccessCriterion: "Maintains entry speed later into the corner without overshooting the line.",
    successCriterion: "Tu gardes ta vitesse d'entrée plus loin dans le virage, sans élargir ta trajectoire.",
  },
  braking_marked_zone_at_speed: {
    sourceExecutionCue:
      "Mark one short braking zone before each technical feature — brake hard there only, then release fully and ride the feature off the brakes.",
    executionCue:
      "Marque une courte zone de freinage avant chaque passage technique — freine fort uniquement là, puis relâche complètement et passe l'obstacle sans freiner.",
    sourceSuccessCriterion: "Brakes only in the marked zones and rides every technical feature off the brakes, at race speed, on 3/5 runs.",
    successCriterion:
      "Tu freines seulement dans les zones marquées et tu passes chaque passage technique sans freiner, à vitesse course, sur 3 runs sur 5.",
  },
  cornering_flat_turn_precision: {
    sourceExecutionCue: "Pick the marked apex before entry and steer your front wheel through it every run.",
    executionCue: "Choisis le point de corde marqué avant l'entrée et fais passer ta roue avant dessus à chaque run.",
    sourceSuccessCriterion: "Hits the marked apex within a bike length on 4/5 runs.",
    successCriterion: "Tu passes à moins d'une longueur de vélo du point de corde marqué, sur 4 runs sur 5.",
  },
  cornering_berm_speed: {
    sourceExecutionCue: "Load the berm early with your outside pedal down and drive weight into the wall through the exit.",
    executionCue: "Pédale extérieure en bas, charge tôt le virage relevé et garde ton poids appuyé dedans jusqu'à la sortie.",
    sourceSuccessCriterion: "Exits the berm faster than entry speed on 3/5 runs, no drift correction.",
    successCriterion: "Tu sors du virage relevé plus vite que tu n'y es entré, sans devoir rattraper une glisse, sur 3 runs sur 5.",
  },
  // TODO(REV-015.4a): coach DH validation recommended — "low side of the bike" is ambiguous, and pedaling through an off-camber risks a pedal strike.
  cornering_off_camber: {
    sourceExecutionCue:
      "Commit your weight into the low side of the bike and keep pedaling through the off-camber section — don't back off mid-turn.",
    executionCue: "Engage ton poids côté aval du vélo et continue de pédaler dans la section en dévers — ne lâche rien en plein virage.",
    sourceSuccessCriterion: "Completes the off-camber section on line, without a foot-down, on 3/5 runs.",
    successCriterion: "Tu passes la section en dévers sur ta ligne, sans pied posé, sur 3 runs sur 5.",
  },
  line_choice_two_line_scan: {
    sourceExecutionCue:
      "Stop above a short technical section, pick one of two possible lines, then ride exactly that line at controlled speed — take the other line on the next run.",
    executionCue:
      "Arrête-toi au-dessus d'une courte section technique, choisis une des deux lignes possibles, puis roule exactement celle-là à vitesse contrôlée — prends l'autre au run suivant.",
    sourceSuccessCriterion: "Rides the line chosen before entry from start to exit, at controlled speed, on 4/5 runs.",
    successCriterion: "Tu tiens la ligne choisie avant l'entrée, du début à la sortie, à vitesse contrôlée, sur 4 runs sur 5.",
  },
  line_choice_rock_garden: {
    sourceExecutionCue: "Scan the rock garden from a distance, call your line out loud, then commit to it without changing mid-section.",
    executionCue: "Observe le pierrier de loin, annonce ta ligne à voix haute, puis engage-toi sans en changer en cours de section.",
    sourceSuccessCriterion: "Calls the line out loud before entry and executes it on 4/5 runs.",
    successCriterion: "Tu annonces ta ligne à voix haute avant l'entrée et tu la tiens, sur 4 runs sur 5.",
  },
  line_choice_fast_line_compare: {
    sourceExecutionCue:
      "Time the same rock garden on two different lines at race speed, then ride the faster one three runs in a row without changing it mid-section.",
    executionCue:
      "Chronomètre le même pierrier sur deux lignes différentes à vitesse course, puis roule la plus rapide trois runs d'affilée sans en changer en cours de section.",
    sourceSuccessCriterion: "Identifies the faster of two lines by timing, then repeats it cleanly at race speed on 3/5 runs.",
    successCriterion: "Tu identifies la ligne la plus rapide au chrono, puis tu la répètes proprement à vitesse course, sur 3 runs sur 5.",
  },
  steep_terrain_controlled_roll_in: {
    sourceExecutionCue:
      "Pick one short steep pitch, set a slow speed before the roll-in, then ride it heels down and weight back, braking smoothly with both brakes.",
    executionCue:
      "Choisis une courte pente raide, règle une vitesse lente avant l'entrée, puis descends-la talons bas et poids en arrière, en freinant en douceur avec les deux freins.",
    sourceSuccessCriterion: "Rolls the pitch at a slow, steady speed without skidding or front-wheel wash on 4/5 runs.",
    successCriterion: "Tu descends la pente à vitesse lente et régulière, sans déraper ni perdre l'avant, sur 4 runs sur 5.",
  },
  // TODO(REV-015.4a): coach DH validation recommended — shifting weight too far back unloads the front wheel (the source instruction itself deserves review).
  steep_terrain_body_position: {
    sourceExecutionCue: "Drop your heels and shift weight rearward as the trail steepens — keep your arms bent, not locked out.",
    executionCue: "Baisse les talons et recule ton poids à mesure que la pente se raidit — garde les bras fléchis, jamais tendus.",
    sourceSuccessCriterion: "Weight stays centered/rearward as required, no front-wheel wash, on 4/5 runs.",
    successCriterion: "Ton poids reste centré ou en arrière selon la pente, sans perte de l'avant, sur 4 runs sur 5.",
  },
  // TODO(REV-015.4a): coach DH validation recommended (priority) — steep chute + releasing the brakes; the "before → during → bottom" order must stay intact.
  steep_terrain_off_brake_chute: {
    sourceExecutionCue:
      "Scrub speed before the chute, release the brakes through the steepest part and let the bike run out at the bottom — heels down, eyes on the exit.",
    executionCue:
      "Casse ta vitesse avant le couloir raide, lâche les freins dans la partie la plus raide et laisse filer le vélo en bas — talons bas, regard sur la sortie.",
    sourceSuccessCriterion: "Rides the steepest part of the chute off the brakes, with no front-wheel wash, on 3/5 runs.",
    successCriterion: "Tu passes la partie la plus raide du couloir sans freiner et sans perte de l'avant, sur 3 runs sur 5.",
  },
  roots_rocks_rolling: {
    sourceExecutionCue: "Keep a light grip and let the bike move under you — stay off the brakes once you commit to the section.",
    executionCue: "Garde une prise légère sur le guidon et laisse le vélo bouger sous toi — ne freine plus une fois engagé dans la section.",
    sourceSuccessCriterion: "Maintains momentum through the section without unplanned dabs on 4/5 runs.",
    successCriterion: "Tu gardes ton élan sur toute la section, sans pied posé imprévu, sur 4 runs sur 5.",
  },
  roots_rocks_unweighted_line: {
    sourceExecutionCue:
      "Spot the biggest roots and rocks before entry, lighten the front wheel over each one with a small push of the hips, and keep your pedals level through the section.",
    executionCue:
      "Repère les plus grosses racines et pierres avant l'entrée, allège la roue avant sur chacune par une petite poussée des hanches, et garde les pédales à l'horizontale dans la section.",
    sourceSuccessCriterion: "Clears the section with momentum and no front-wheel deflection on 4/5 runs.",
    successCriterion: "Tu passes la section avec de l'élan, sans que l'avant dévie, sur 4 runs sur 5.",
  },
  roots_rocks_committed: {
    sourceExecutionCue: "Pick your line before entry and carry race-pace speed through — trust the bike to track over the roots.",
    executionCue: "Choisis ta ligne avant l'entrée et garde ta vitesse course jusqu'au bout — fais confiance au vélo pour passer les racines.",
    sourceSuccessCriterion: "Clears the section at race-relevant speed on 3/5 runs.",
    successCriterion: "Tu passes la section à une vitesse proche de la course, sur 3 runs sur 5.",
  },
  jumps_table_top_basic: {
    sourceExecutionCue: "Keep your pedals level and push evenly through the lip — absorb the landing with bent knees, not your back.",
    executionCue: "Garde les pédales à l'horizontale et pousse de façon égale sur le kick — absorbe la réception avec les genoux fléchis, pas avec le dos.",
    sourceSuccessCriterion: "Clean take-off and landing, wheels level, on 4/5 runs.",
    successCriterion: "Tu décolles et tu te réceptionnes proprement, roues à plat, sur 4 runs sur 5.",
  },
  jumps_linked_tables: {
    sourceExecutionCue:
      "Ride two or three tables in a row without pedaling between them — pump each landing to carry speed into the next take-off.",
    executionCue: "Enchaîne deux ou trois table-tops sans pédaler entre eux — pompe chaque réception pour garder ta vitesse jusqu'au décollage suivant.",
    sourceSuccessCriterion: "Clears two or three tables in a row with level landings and no speed-check braking on 3/5 runs.",
    successCriterion:
      "Tu passes deux ou trois table-tops d'affilée, réceptions à plat, sans coup de frein pour contrôler ta vitesse, sur 3 runs sur 5.",
  },
  jumps_step_down: {
    sourceExecutionCue: "Match your pop to the gap size and spot the landing early — commit to the speed, don't back off in the air.",
    executionCue: "Adapte ton pop à la distance à franchir et repère la réception tôt — engage-toi sur ta vitesse, ne te retiens pas en l'air.",
    sourceSuccessCriterion: "Consistent, controlled landing on 3/5 runs, no case/overshoot.",
    successCriterion: "Tu te réceptionnes de façon régulière et contrôlée, sans caser ni atterrir trop long, sur 3 runs sur 5.",
  },
  race_execution_section_consistency: {
    sourceExecutionCue:
      "Time 3 to 5 runs of the same short section at a pace you can repeat — same start, same line, same braking points every run.",
    executionCue:
      "Chronomètre 3 à 5 runs de la même courte section, à un rythme que tu peux répéter — même départ, même ligne, mêmes points de freinage à chaque run.",
    sourceSuccessCriterion: "All timed runs of the section within 2 seconds of each other, with no crash or foot-down.",
    successCriterion: "Tous tes runs chronométrés sur la section restent à moins de 2 secondes les uns des autres, sans chute ni pied posé.",
  },
  race_execution_split_pace: {
    sourceExecutionCue:
      "Mark a 1–2 minute technical section with a midway split, ride it at race intent from a standing start, then compare the two splits and repeat, fixing the slower half.",
    executionCue:
      "Marque une section technique de 1 à 2 minutes avec un split à mi-parcours, roule-la en mode course depuis un départ arrêté, puis compare les deux splits et recommence en corrigeant la moitié la plus lente.",
    sourceSuccessCriterion: "Rides the section at race intent with both splits within 3% of the best run on 2/3 runs.",
    successCriterion: "Tu roules la section en mode course, tes deux splits à moins de 3 % de ton meilleur run, sur 2 runs sur 3.",
  },
  race_execution_full_run_sim: {
    sourceExecutionCue: "Ride the full track at race intent from the first gate to the finish line — treat every section like it counts.",
    executionCue: "Roule la piste complète en mode course, du départ jusqu'à l'arrivée — traite chaque section comme si elle comptait.",
    sourceSuccessCriterion: "Completes a full timed run within a declared target margin of best practice time.",
    successCriterion: "Tu termines un run complet chronométré dans la marge que tu t'es fixée par rapport à ton meilleur temps d'entraînement.",
  },
};

function translationFor(drillId: unknown): DrillInstructionTranslation | null {
  return typeof drillId === "string" && Object.prototype.hasOwnProperty.call(DRILL_INSTRUCTION_LABELS, drillId)
    ? DRILL_INSTRUCTION_LABELS[drillId]!
    : null;
}

/** The stored text itself when it is a non-blank string, else `null` (nothing to show). */
function storedOrNull(stored: unknown): string | null {
  return typeof stored === "string" && stored.trim() !== "" ? stored : null;
}

/**
 * French execution cue when the drill is known AND the stored text is exactly
 * its English source; otherwise the stored original text (kept so the
 * instruction stays available); `null` only when nothing is stored.
 */
export function translateDrillExecutionCue(drillId: unknown, storedExecutionCue: unknown): string | null {
  const translation = translationFor(drillId);
  if (translation !== null && storedExecutionCue === translation.sourceExecutionCue) return translation.executionCue;
  return storedOrNull(storedExecutionCue);
}

/** Same rule as translateDrillExecutionCue, for the success criterion. */
export function translateDrillSuccessCriterion(drillId: unknown, storedSuccessCriterion: unknown): string | null {
  const translation = translationFor(drillId);
  if (translation !== null && storedSuccessCriterion === translation.sourceSuccessCriterion) return translation.successCriterion;
  return storedOrNull(storedSuccessCriterion);
}
