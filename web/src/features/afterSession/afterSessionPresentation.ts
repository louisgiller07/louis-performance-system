import { formatIntervention } from "../dailyPlan/dailyPlanLabels";
import { formatDuration } from "../dailyPlan/durationLabels";
import type { TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import { SESSION_TYPE_LABELS, type CompletedSessionRecord, type CompletionStatus, type LinkableDecision } from "../completedSession/completedSessionTypes";
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

export const BUTTONS = {
  next: "Continuer",
  back: "Retour",
  save: "Enregistrer ma séance",
  saving: "Enregistrement…",
  edit: "Modifier",
} as const;

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
    case "body":
      return status === "skipped"
        ? { title: "Ton corps", question: "Comment se sentent tes jambes et tes avant-bras ? (facultatif)" }
        : { title: "Ton corps", question: "Comment se sentent tes jambes et tes avant-bras ?" };
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
} as const;

export const EFFORT = {
  anchors: [
    { value: 0, label: "Repos" },
    { value: 5, label: "Modéré" },
    { value: 10, label: "Maximal" },
  ],
} as const;

// Same anchors as the morning check-in's own scales (CheckinForm).
export const BODY = {
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
