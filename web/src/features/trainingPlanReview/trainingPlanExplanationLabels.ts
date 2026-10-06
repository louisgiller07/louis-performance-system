// REV-013 — athlete-facing French for the training plan's engine-written
// explanations (training_plan_versions.rationale, training_plan_weeks.
// rationale, training_plan_generated_sessions.rationale). Presentation only:
// the stored English text is never changed, so already-persisted plans are
// translated at display time too.
//
// Every phrase below is copied verbatim from the engines (never imported —
// no shared build boundary, same discipline as trainingPlanReviewTypes.ts):
// - head-coach-engine generateAndPersistTrainingPlan.ts RATIONALE_FOR_TRIGGER
//   (version rationale);
// - planning-engine planningPipelineOrchestrator.ts PHRASE_FOR_SELECTION_REASON
//   (first part of every week and session rationale), plus its
//   "N constraint(s) relaxed." week suffix;
// - planning-engine blockProgressionV2.ts BLOCK_PROGRESSION_PHRASES_V2 (V2
//   week roles and their holds / adaptations, BUG-V2-2: first parts of a V2
//   week and session rationale);
// - planning-engine historyAdjuster.ts ADJUSTMENT_REASON and
//   constraintResolver.ts's recovery_spacing reason (session suffixes).
// The engines join these parts with a single space (composeWeekRationale/
// composeSessionRationale), which is what translateExplanation parses.

export type ExplanationContext = "version" | "week" | "session";

const KNOWN_PHRASES: ReadonlyArray<readonly [english: string, french: string]> = [
  // Version rationale (RATIONALE_FOR_TRIGGER).
  ["Initial training plan generation.", "Première génération de ton plan d'entraînement."],
  ["Regenerated after a race was added to the calendar.", "Plan régénéré après l'ajout d'une course au calendrier."],
  ["Regenerated after a race was removed from the calendar.", "Plan régénéré après le retrait d'une course du calendrier."],
  ["Regenerated after declared availability changed.", "Plan régénéré après une modification de tes disponibilités."],
  ["Regenerated after declared equipment changed.", "Plan régénéré après une modification de ton équipement."],
  ["Regenerated after a pattern of missed or replaced sessions.", "Plan régénéré après plusieurs séances manquées ou remplacées."],
  ["Regenerated after a manual edit.", "Plan régénéré après une modification manuelle."],
  ["Regenerated due to a planner/ruleset version upgrade.", "Plan régénéré après une mise à jour de la méthode de planification."],
  // Week type selection (PHRASE_FOR_SELECTION_REASON).
  ["Race week: minimal structured volume, no new strength stimulus.", "Semaine de course : volume structuré minimal, pas de nouveau travail de force."],
  [
    "Taper week ahead of an upcoming race: reduced volume versus a normal development week.",
    "Semaine d'affûtage avant une course : volume réduit par rapport à une semaine de développement normale.",
  ],
  ["Week type set by an explicit upstream recovery/deload indication.", "Type de semaine défini par une indication de récupération ou d'allègement."],
  ["Standard development week.", "Semaine standard de développement."],
  // V2 block progression (BLOCK_PROGRESSION_PHRASES_V2) — week role, then its holds / adaptations.
  ["Introduction week: baseline doses to start the block.", "Semaine d'introduction : doses de base pour démarrer le bloc."],
  ["Return week after the race: back to baseline doses.", "Semaine de reprise après la course : retour aux doses de base."],
  ["Build week: standard development load.", "Semaine de construction : charge de développement standard."],
  ["Build week: load raised from the previous cycle.", "Semaine de construction : charge augmentée par rapport au cycle précédent."],
  ["Overload week: the highest load of the cycle.", "Semaine de surcharge : la charge la plus haute du cycle."],
  ["Consolidation week: reduced load to absorb the previous weeks.", "Semaine de consolidation : charge réduite pour assimiler les semaines précédentes."],
  [
    "Race-specific week, two weeks before the race: riding first, strength maintained without overload.",
    "Semaine spécifique course, deux semaines avant : priorité au pilotage, force maintenue sans surcharge.",
  ],
  ["Recent training history: the block starts at build level.", "Entraînement récent pris en compte : le bloc démarre directement en construction."],
  ["Overload postponed: several recent sessions were missed or replaced.", "Surcharge reportée : plusieurs séances récentes ont été manquées ou remplacées."],
  ["Fixed sessions this week: load held, no increase.", "Séances fixes cette semaine : charge maintenue, sans augmentation."],
  ["Strength volume kept moderate for a beginner level.", "Volume de force maintenu modéré pour un niveau débutant."],
  ["Sessions shortened to fit the available time.", "Séances raccourcies pour tenir dans le temps disponible."],
  // Session suffixes (no trailing period in the engine).
  ["Adjusted due to recent missed or replaced sessions pattern", "Charge allégée car plusieurs séances récentes ont été manquées ou remplacées."],
  ["Reduced heavy strength load to avoid consecutive heavy strength sessions", "Charge de force réduite pour éviter deux séances lourdes d'affilée."],
];

/** composeWeekRationale's suffix — a count of relaxed constraints, surfaced as a summary, never as part of the explanation. */
const RELAXED_COUNT_PATTERN = /(\d+) constraint\(s\) relaxed\./g;

/** Shown only when a non-empty explanation contains no recognized part at all — never the raw English. */
const NEUTRAL_FALLBACK: Record<ExplanationContext, string> = {
  version: "Plan généré à partir de ta configuration.",
  week: "Semaine planifiée à partir de ta configuration.",
  session: "Séance prévue par ton programme.",
};

export interface TranslatedExplanation {
  /** French explanation, or `null` when there is nothing to show. */
  text: string | null;
  /** From "N constraint(s) relaxed." when present, else `null`. */
  attentionPointCount: number | null;
}

interface Match {
  start: number;
  end: number;
  french?: string;
  count?: number;
}

/** A match only counts on whole-part boundaries (start of text or after a space; end of text or before a space), so a known phrase embedded inside an unknown sentence is never picked out of it. */
function onPartBoundary(text: string, start: number, end: number): boolean {
  return (start === 0 || text[start - 1] === " ") && (end === text.length || text[end] === " ");
}

function findMatches(text: string): Match[] {
  const matches: Match[] = [];
  for (const [english, french] of KNOWN_PHRASES) {
    for (let at = text.indexOf(english); at !== -1; at = text.indexOf(english, at + 1)) {
      if (onPartBoundary(text, at, at + english.length)) matches.push({ start: at, end: at + english.length, french });
    }
  }
  for (const match of text.matchAll(RELAXED_COUNT_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (onPartBoundary(text, start, end)) matches.push({ start, end, count: Number(match[1]) });
  }
  // Left to right; on overlap the earlier (then longer) match wins.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  for (const match of matches) {
    const previous = kept[kept.length - 1];
    if (previous === undefined || match.start >= previous.end) kept.push(match);
  }
  return kept;
}

/**
 * Translates one engine explanation. Known parts are translated in order;
 * an unknown part is dropped, never shown in English; if no part at all is
 * recognized, a neutral sentence for the context is returned instead. A
 * missing/blank value yields nothing.
 */
export function translateExplanation(raw: unknown, context: ExplanationContext): TranslatedExplanation {
  if (typeof raw !== "string" || raw.trim() === "") return { text: null, attentionPointCount: null };
  const text = raw.trim();

  const matches = findMatches(text);
  const translated: string[] = [];
  let attentionPointCount: number | null = null;
  let unmatched = "";
  let cursor = 0;
  for (const match of matches) {
    unmatched += text.slice(cursor, match.start);
    cursor = match.end;
    if (match.count !== undefined) attentionPointCount = (attentionPointCount ?? 0) + match.count;
    else translated.push(match.french!);
  }
  unmatched += text.slice(cursor);
  const hasUnknownPart = unmatched.trim() !== "";

  if (translated.length > 0) return { text: translated.join(" "), attentionPointCount };
  return { text: hasUnknownPart ? NEUTRAL_FALLBACK[context] : null, attentionPointCount };
}

/** "1 point d'attention cette semaine." / "3 points d'attention cette semaine." — `null` for none. */
export function formatWeekAttentionSummary(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return count === 1 ? "1 point d'attention cette semaine." : `${count} points d'attention cette semaine.`;
}
