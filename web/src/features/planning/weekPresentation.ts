import { LOAD_PROFILE_LABELS, TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { TrainingPlanReviewSession } from "../trainingPlanReview/trainingPlanReviewTypes";
import type { LoadProfile, PlannedSessionRow, TrainingInterventionKind } from "./planningTypes";

// UX-10B-2B — "Modifier ma semaine", in a rider's words. Every sentence here
// must match what the system really does:
// - a day of the active plan with no planned row yet is still "Prévue par
//   ton plan": the daily projection (V0.4_015) writes it before the next
//   decision;
// - removing a plan day would not free it (the projection re-creates any
//   missing plan day), so a plan day is "passé en repos" — an athlete
//   modification the projection never overwrites;
// - "Revenir au plan" deletes the athlete's modification; the plan's session
//   comes back at the next update, never instantly;
// - "Libre" only when the active plan has nothing that day.

export const PAGE = {
  back: "Programme",
  title: "Modifier ma semaine",
  subtitle: "Ajuste tes 7 prochains jours. NALYNT adapte ensuite chaque séance à ton état du matin.",
  role: "Ici, tu ajustes ton planning. Tes décisions du jour restent prises avec ton état réel.",
  loadErrorTitle: "Semaine indisponible",
  loadError: "Impossible de charger tes 7 prochains jours pour le moment.",
  retry: "Réessayer",
  racesUnavailable: "Le calendrier de courses est indisponible pour l'instant.",
  planUnavailable: "Ton plan n'a pas pu être lu pour l'instant : un jour sans séance peut encore en recevoir une de ton plan.",
} as const;

export const DAY = {
  today: "Aujourd'hui",
  fromPlan: "Prévue par ton plan",
  modified: "Modifiée par toi",
  free: "Libre",
  addSession: "Ajouter une séance",
  noSessionOnRaceDay: "Aucune séance ajoutée",
  unknown: "Aucune séance",
  legacy: (label: string) => `Ancienne séance planifiée : ${label}. Choisis une séance pour la modifier.`,
  legacyFallback: "Séance planifiée (ancienne)",
  unknownPlanSession: "Séance de ton plan",
  committed: "Séance engagée",
  race: "Course / événement",
} as const;

export const EDITOR = {
  session: "Séance",
  intensity: "Intensité",
  duration: "Durée prévue",
  noDuration: "Pas de durée",
  shorter: "Réduire la durée",
  longer: "Augmenter la durée",
  committed: "Séance engagée",
  committedHint: "Cette séance compte comme une priorité. NALYNT peut ensuite l'alléger ou l'adapter selon ton état.",
  save: "Enregistrer",
  saving: "Enregistrement…",
  toRest: "Passer en repos",
  toRestHint: "Cette journée sera conservée comme une modification de ton planning.",
  backToPlan: "Revenir au plan",
  backToPlanHint: "NALYNT remettra la séance prévue par ton plan lors de la prochaine mise à jour.",
  remove: "Retirer cette séance",
  removeHint: "Le jour redevient libre.",
  genericError: "Une erreur est survenue. Réessaie dans un instant.",
  // P0-3 — what NALYNT will really do with a session added or changed by hand (never a false promise).
  manualV1Hint: "Sur ton programme actuel, une séance ajoutée à la main n'a pas de contenu détaillé : NALYNT n'en connaît que le type et la charge.",
  manualV2UnsupportedHint: "NALYNT ne construit pas encore le contenu de ce type de séance : seuls son type et sa charge seront connus.",
  manualV2HeavyHint: "NALYNT ne construit pas encore le contenu d'un renfo en charge lourde : choisis une charge modérée ou légère pour obtenir le détail de la séance.",
} as const;

/**
 * V1-WARN-01 — HPM-approved wording (2026-10-20) for a heavy lower-body Force planned by hand one or two days before
 * a known DH day or race. Says the rider added it and that the coach did not validate this sequence; it says nothing
 * about any other session.
 */
export const HEAVY_LOWER_BEFORE_DH = {
  title: "Force lourde avant une journée DH",
  body: "Tu as ajouté une séance de Force lourde du bas du corps un ou deux jours avant une journée DH prévue.",
  advice: "Cet enchaînement n'a pas été validé par le coach NALYNT. Vérifie que ta récupération est suffisante et adapte ton entraînement si nécessaire.",
} as const;

/** P0-3 — the kinds (and loads) for which the V2 daily engine builds a manual session's content (mirror of planning-engine's REPLACE builders). */
export const MANUAL_V2_BUILT_KINDS: readonly string[] = ["STRENGTH_LOWER", "STRENGTH_UPPER", "DH_TECHNICAL", "DH_LIGHT", "AEROBIC_BASE", "RECOVERY_ACTIVE", "REST"];

/** P0-3 — the honest note shown before saving a manual session; null when NALYNT will build its content (or the model is unknown). */
export function manualSessionHint(planModel: "v1" | "v2" | null, kind: string, load: string | null): string | null {
  if (kind === "" || kind === "REST" || planModel === null) return null;
  if (planModel === "v1") return EDITOR.manualV1Hint;
  if (!MANUAL_V2_BUILT_KINDS.includes(kind)) return EDITOR.manualV2UnsupportedHint;
  if ((kind === "STRENGTH_LOWER" || kind === "STRENGTH_UPPER") && load === "HEAVY") return EDITOR.manualV2HeavyHint;
  return null;
}

/** The plan's own session for one date, as the athlete sees it (kind/load/duration from the active plan read — never computed). */
export interface PlanDaySession {
  kind: string;
  loadProfile: string | null;
  durationMin: number | null;
}

export function planSessionsByDate(sessions: readonly TrainingPlanReviewSession[], dates: readonly string[]): Record<string, PlanDaySession> {
  const wanted = new Set(dates);
  const byDate: Record<string, PlanDaySession> = {};
  for (const session of sessions) {
    if (!wanted.has(session.date) || byDate[session.date]) continue;
    byDate[session.date] = { kind: session.kind, loadProfile: session.loadProfile, durationMin: session.durationMin };
  }
  return byDate;
}

/**
 * Where a day stands:
 * - "plan": the projection's row, or a plan day not projected yet;
 * - "modified": the athlete's own row on a day the plan also covers;
 * - "added": the athlete's own row on a day the plan leaves free;
 * - "free": nothing planned, and the plan has nothing that day;
 * - "unknown": nothing planned, but the plan could not be read.
 * A legacy/rule/template row counts as the athlete's (never overwritten by the projection).
 */
export type DayState = "plan" | "modified" | "added" | "free" | "unknown" | "manual-unknown";

export function dayState(row: PlannedSessionRow | null, planSession: PlanDaySession | null, planKnown: boolean): DayState {
  if (row?.source === "generated") return "plan";
  if (row) {
    if (!planKnown) return "manual-unknown";
    return planSession ? "modified" : "added";
  }
  if (!planKnown) return "unknown";
  return planSession ? "plan" : "free";
}

/** Badge for the collapsed card — "Modifiée par toi" only for a row carrying a real intervention (never a guessed origin for a legacy row). */
export function dayBadge(state: DayState, row: PlannedSessionRow | null): string | null {
  if (state === "plan") return DAY.fromPlan;
  if ((state === "modified" || state === "added" || state === "manual-unknown") && row?.source === "manual" && row.intervention !== null) {
    return DAY.modified;
  }
  return null;
}

export function kindLabel(kind: string): string {
  return TRAINING_KIND_LABELS[kind as TrainingInterventionKind] ?? DAY.unknownPlanSession;
}

export function loadLabel(load: string | null | undefined): string | null {
  return load ? (LOAD_PROFILE_LABELS[load as LoadProfile] ?? null) : null;
}

export function formatDuration(durationMin: unknown): string | null {
  if (typeof durationMin !== "number" || !Number.isFinite(durationMin) || durationMin <= 0) return null;
  const hours = Math.floor(durationMin / 60);
  const minutes = durationMin % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes}`;
}
