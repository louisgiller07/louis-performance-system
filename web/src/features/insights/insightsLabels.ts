import type { PatternInsightCandidateReviewState, PatternInsightDirection, PatternInsightReviewDecision } from "./insightsTypes";

// Friendly labels only — never a reinterpretation of the underlying
// semantics. reviewed_stale means the review concerns an older candidate
// snapshot, never "rejected/invalid/deleted/revoked" (see
// docs/06_ARCHITECTURE.md's locked reviewed_current/reviewed_stale
// derivation).
export const REVIEW_DECISION_LABELS: Record<PatternInsightReviewDecision, string> = {
  accepted_as_insight: "Accepter comme insight",
  dismissed: "Rejeter",
  needs_more_evidence: "Besoin de plus de données",
};

export const REVIEW_STATE_LABELS: Record<PatternInsightCandidateReviewState, string> = {
  unreviewed: "Non revu",
  reviewed_current: "Revu — à jour",
  reviewed_stale: "Revu — l'insight a changé depuis",
};

export const DIRECTION_LABELS: Record<PatternInsightDirection, string> = {
  supporting: "Confirmé",
  contradicting: "Contredit",
  mixed: "Partagé",
  neutral: "Neutre",
};
