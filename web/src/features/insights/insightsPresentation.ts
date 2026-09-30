import type { PatternInsightDirection, PatternInsightKind, PatternInsightReviewDecision } from "./insightsTypes";

// UX-10B-2A — "Ce que NALYNT remarque", in a rider's words. The engine keeps
// its data (kind, direction, counts, period, caveats) untouched; the web
// only chooses the wording, like every other label. Rules:
// - a response is feedback only: it changes no plan, no decision, no future
//   recommendation — and the page says so;
// - no causal claim, no interpretation beyond what the engine observed
//   ("vont le plus souvent avec", never "grâce à" / "cause");
// - counts are observations, never days, sessions or "analyses";
// - no promised delay: trends appear when the engine has observed them.

export const PAGE = {
  back: "Historique",
  title: "Ce que NALYNT remarque",
  subtitle: "Des tendances observées dans tes check-ins et tes séances. Elles ne changent pas ton plan.",
  emptyTitle: "Rien à te montrer pour l'instant",
  empty: "Quand des tendances sont observées dans tes check-ins et tes séances, elles apparaissent ici.",
  retry: "Réessayer",
  loadErrorTitle: "Impossible d'afficher les tendances",
  close: "Fermer",
} as const;

export const KIND_TITLES: Record<PatternInsightKind, string> = {
  recommendation_execution_alignment: "Réalisation de tes séances",
  sleep_energy_same_day_association: "Sommeil et énergie",
  pain_persistence_between_recent_checkins: "Douleur d'un check-in à l'autre",
};

export const STATEMENTS: Record<PatternInsightKind, Record<PatternInsightDirection, string>> = {
  recommendation_execution_alignment: {
    supporting: "Tes séances recommandées sont le plus souvent réalisées comme prévu.",
    contradicting: "Tes séances recommandées sont plus souvent remplacées ou sautées que réalisées comme prévu.",
    mixed: "Tes séances recommandées sont tantôt réalisées comme prévu, tantôt remplacées ou sautées.",
    neutral: "Les observations disponibles ne montrent pas de tendance nette sur la réalisation de tes séances.",
  },
  sleep_energy_same_day_association: {
    supporting: "Tes nuits de meilleure qualité vont le plus souvent avec plus d'énergie le jour même.",
    contradicting: "Tes nuits de meilleure qualité ne vont le plus souvent pas avec plus d'énergie le jour même.",
    mixed: "Le lien entre la qualité de tes nuits et ton énergie du jour est partagé.",
    neutral: "Les observations disponibles ne montrent pas de lien net entre tes nuits et ton énergie du jour.",
  },
  pain_persistence_between_recent_checkins: {
    supporting: "Une douleur signalée l'est le plus souvent encore au check-in suivant, dans les 3 jours.",
    contradicting: "Une douleur signalée a le plus souvent disparu au check-in suivant, dans les 3 jours.",
    mixed: "Une douleur signalée est tantôt encore présente, tantôt disparue au check-in suivant.",
    neutral: "Les observations disponibles ne montrent pas de tendance nette sur tes douleurs d'un check-in à l'autre.",
  },
};

export function observations(count: number): string {
  return count === 1 ? "1 observation" : `${count} observations`;
}

export const RESPONSES: Record<PatternInsightReviewDecision, string> = {
  accepted_as_insight: "Ça me parle",
  dismissed: "Pas vraiment",
  needs_more_evidence: "Pas encore sûr",
};

export const RESPONSE = {
  question: "Ça te parle ?",
  keep: "Ta réponse est gardée ; elle ne modifie pas ton plan.",
  noteLabel: "Ajouter une précision (facultatif)",
  noteHint: "Ta précision ne modifie pas ton plan.",
  answered: (decision: PatternInsightReviewDecision) => `Tu as répondu : ${RESPONSES[decision]}`,
  stale: "Cette tendance a changé depuis ta réponse. Tu peux répondre à nouveau.",
  saved: "Réponse enregistrée.",
} as const;
