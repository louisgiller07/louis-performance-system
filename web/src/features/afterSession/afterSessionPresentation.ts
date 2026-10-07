import { formatIntervention } from "../dailyPlan/dailyPlanLabels";
import { formatDuration } from "../dailyPlan/durationLabels";
import type { TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import { CHANGE_REASONS, SESSION_TYPE_LABELS, type ChangeReason, type CompletedSessionRecord, type CompletionStatus, type LinkableDecision } from "../completedSession/completedSessionTypes";
import type { AfterSessionStepId } from "./afterSessionSteps";

// UX-08 — every word of the after-session moment, in one place (same
// discipline as coachInsights / raceLabels / safetyPresentation): the flow
// state (useCompletedSessionFlow) carries no text. A coaching moment, never
// an administrative form, never a judgment: facts the athlete declares, no
// "bonne / mauvaise séance", no score. "RPE" and "grip" are never shown.

export const STATUS_CHOICES: readonly { status: CompletionStatus; icon: string; label: string }[] = [
  { status: "done", icon: "✓", label: "Terminée" },
  { status: "partial", icon: "◐", label: "Partiellement" },
  { status: "replaced", icon: "↻", label: "J'ai fait autre chose" },
  { status: "skipped", icon: "×", label: "Non réalisée" },
];

/** How a recorded session reads for the athlete (History, summaries). */
export const OUTCOME_LABELS: Record<CompletionStatus, string> = {
  done: "Réalisée",
  partial: "Partiellement réalisée",
  replaced: "Remplacée",
  skipped: "Non réalisée",
};

export const ENTRY = {
  kicker: "Après ta séance",
  title: "Ta séance est faite ?",
  action: "Raconter ma séance",
  sheetTitle: "Ta séance",
  sheetLabel: "Après ta séance",
  closeLabel: "Fermer",
  loadError: "Impossible de charger ta séance. Réessaie dans un instant.",
} as const;

/** UX-11R.9 (F-5) — the day was completed as a guided session: no separate debrief. */
export const GUIDED_DONE = {
  title: "Séance guidée terminée",
  body: "Ta séance du jour est enregistrée dans la séance guidée.",
  link: "Voir la séance guidée",
} as const;

/** UX-11R.9 (F-5b) — a guided session is open today: it is the day's session, no separate debrief. */
export const GUIDED_OPEN = {
  title: "Séance guidée en cours",
  body: "Ta séance du jour se raconte dans la séance guidée.",
  link: "Reprendre la séance guidée",
} as const;

export const BUTTONS = {
  next: "Continuer",
  back: "Retour",
  save: "Enregistrer ma séance",
  saving: "Enregistrement…",
  edit: "Modifier",
  retry: "Réessayer",
} as const;

/** A11 — « Bilan — Renfo bas du corps »: the session the debrief is about, by name. */
export function flowTitle(sessionLabel: string): string {
  return `Bilan — ${sessionLabel}`;
}

/**
 * A11 — the reasons offered. A skipped session: the coaching reasons that
 * exist (time, fatigue, pain, weather / terrain, equipment, motivation,
 * other) — not « coach criterion » nor « activity change » (those describe a
 * session that took place). A partial / replaced one: every reason, the
 * coach criterion only with a linked plan.
 */
const SKIPPED_REASONS: readonly ChangeReason[] = ["time_life", "fatigue_control", "pain", "weather_terrain", "mechanical", "motivation", "other"];
export function reasonsFor(status: CompletionStatus, linked: boolean): readonly ChangeReason[] {
  if (status === "skipped") return SKIPPED_REASONS;
  return CHANGE_REASONS.filter((reason) => reason !== "coach_criterion" || linked);
}

export function stepCopy(step: AfterSessionStepId, status: CompletionStatus): { title: string; question: string } {
  switch (step) {
    case "status":
      return { title: "Ta séance", question: "Séance terminée ?" };
    case "plan":
      return { title: "Ton plan", question: "Quel plan as-tu suivi aujourd'hui ?" };
    case "activity":
      if (status === "skipped") return { title: "La séance", question: "La séance qui était prévue." };
      if (status === "replaced") return { title: "À la place", question: "Qu'as-tu fait à la place ?" };
      return { title: "Ta séance", question: "Ce que tu as fait." };
    case "reason":
      return status === "skipped"
        ? { title: "Ce qui s'est passé", question: "Qu'est-ce qui a changé aujourd'hui ?" }
        : { title: "Ce qui a changé", question: "Qu'est-ce qui a changé pendant ta séance ?" };
    case "effort":
      return { title: "Ton effort", question: "À quel point cette séance t'a sollicité ?" };
    case "signal":
      return { title: "Ton corps", question: "Un signal physique à retenir ?" };
  }
}

export const PLAN = {
  none: "Aucun de ces plans · séance libre",
  linked: "Plan du jour",
  unlink: "Ce n'était pas ce plan",
  free: "Séance libre, sans lien avec le plan du jour.",
  relink: "Relier au plan du jour",
  lookupFailed: "Impossible de vérifier ton plan du jour : ta séance sera enregistrée sans lien.",
  // A11 — the only case where the rider chooses: legacy data NALYNT cannot tell apart.
  ambiguous: "Deux décisions ont été enregistrées au même moment pour ce jour : NALYNT ne peut pas savoir laquelle tu as suivie. Choisis-la.",
} as const;

const TIME = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });

/** "15:43 · DH technique · charge modérée" — the UX-07 wording, never an id. */
export function planOptionLabel(decision: LinkableDecision): string {
  return `${TIME.format(new Date(decision.createdAt))} · ${formatIntervention(decision.finalSession)}`;
}

export const ACTIVITY = {
  change: "Changer d'activité",
  pick: "Choisis l'activité",
  intensity: "Intensité",
  skippedType: "Type de séance prévue",
  asPlanned: (minutes: number) => `Comme prévu · ${formatDuration(minutes)}`,
  otherDuration: "Autre durée",
  duration: "Durée",
  minutes: "minutes",
  less: "Moins 5 minutes",
  more: "Plus 5 minutes",
  dhDurationHelper: "Temps total de la session, remontées, pauses et attente comprises.",
  durationHelper: "Durée réelle de la séance.",
  taskQuestion: "As-tu exécuté la tâche du plan ?",
} as const;

export const REASON = {
  noteRequired: "Précise en quelques mots (obligatoire pour « Autre »)",
  noteOptional: "Un mot de plus ? (facultatif)",
  newPainQuestion: "Est-ce une nouvelle douleur ?",
  painReminder: "Signale-la aussi dans ton prochain check-in : NALYNT adaptera la suite.",
} as const;

// A11 — effort with words: the ends and the middle under the scale, the chosen value named.
export const EFFORT = {
  anchors: [
    { value: 0, label: "Aucun effort" },
    { value: 5, label: "Modéré" },
    { value: 10, label: "Maximal" },
  ],
} as const;

export function effortLabel(value: number): string {
  if (value === 0) return "Aucun effort";
  if (value <= 2) return "Très facile";
  if (value <= 4) return "Facile";
  if (value <= 6) return "Modéré";
  if (value <= 8) return "Difficile";
  if (value === 9) return "Très difficile";
  return "Maximal";
}

// Same anchors as the morning check-in's own scales (CheckinForm).
export const BODY = {
  question: "Comment se sentent tes jambes et tes avant-bras ? (facultatif)",
  legs: { label: "Jambes", low: "Fraîches", high: "Très lourdes" },
  forearms: { label: "Avant-bras", low: "Frais", high: "Très fatigués" },
} as const;

export const SIGNAL = { no: "Non", yes: "Oui", describe: "Décris ce qui t'a gêné" } as const;

export const SUMMARY = {
  title: "Séance enregistrée",
  keeps: "NALYNT garde cette information pour adapter la suite.",
  today: "Aujourd'hui",
  planned: "Prévu",
  done: "Réalisé",
  session: "Séance",
  effort: "Ton effort",
  body: "Ton corps",
  // Never a failure: the day changed, the plan adapts.
  reasonSkipped: "Ce qui a changé aujourd'hui",
  reasonChanged: "Ce qui a changé",
  task: "Tâche du plan",
  signal: "Signal physique",
  signalReminder: "Pense à le mentionner dans ton prochain check-in.",
  promise: ["Ton objectif reste.", "Ton plan s'adapte."],
} as const;

/** "DH technique · charge modérée · 1 h 30" — what was asked. */
export function plannedLine(intervention: TrainingIntervention): string {
  const base = formatIntervention(intervention);
  return intervention.duration_min !== undefined ? `${base} · ${formatDuration(intervention.duration_min)}` : base;
}

/** What was actually done, from the recorded session only. */
export function performedLine(record: CompletedSessionRecord): string {
  if (record.completion_status === "skipped") return OUTCOME_LABELS.skipped;
  const activity = record.intervention ? formatIntervention(record.intervention) : (SESSION_TYPE_LABELS[record.session_type] ?? "Séance");
  return record.actual_duration_min !== null ? `${activity} · ${formatDuration(record.actual_duration_min)}` : activity;
}
