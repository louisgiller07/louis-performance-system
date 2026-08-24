/**
 * M5_005 detector result shapes — recommendation_vs_actual_execution.
 * Pure facts, like relations/types.ts and calculators/types.ts: `eventType
 * === "contradicting"` is a raw classification output, not a judgment
 * about the athlete — this detector answers "does the recorded execution
 * support/contradict/neutrally-relate-to the recommendation", never "was
 * this good/bad" (that remains outside this package entirely).
 */
import type { CompletionStatus, DbSessionType } from "../types/sources.js";

export type DetectorEventType = "supporting" | "contradicting" | "neutral";

/** The one and only rule identity this module ever produces — literal, not `string`, so a caller cannot construct a mismatched detectorRuleId at compile time. */
export type RecommendationVsActualRuleId = "recommendation_vs_actual_execution";

/** Exactly 8 fields (M5_005 lock, point 16) — never more, never fewer. */
export interface RecommendationVsActualObservedValue {
  readonly decisionId: string;
  readonly decisionDate: string;
  readonly recommendedSessionType: DbSessionType;
  /** Literal "explicit" — evidence only ever exists for the explicit execution-relationship state. */
  readonly executionState: "explicit";
  readonly completedSessionId: string;
  readonly completionStatus: CompletionStatus;
  readonly actualSessionType: DbSessionType;
  readonly typeMatchesRecommendation: boolean;
}

/** Exactly 2 fields (M5_005 lock, point 17) — no other IDs. */
export interface RecommendationVsActualSourceRefs {
  readonly decisionId: string;
  readonly completedSessionId: string;
}

/** Exactly 9 top-level fields (M5_005 lock, point 15) — never more, never fewer. */
export interface RecommendationVsActualEvidence {
  readonly kind: "evidence";
  readonly detectorRuleId: RecommendationVsActualRuleId;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly evidenceKey: string;
  readonly eventType: DetectorEventType;
  readonly eventDate: string;
  readonly observedValue: RecommendationVsActualObservedValue;
  readonly sourceRefs: RecommendationVsActualSourceRefs;
}

export type NoEvidenceReason = "no_completed_session" | "same_day_session_unlinked" | "same_day_session_linked_elsewhere";

/**
 * Exactly 6 fields (M5_005 lock, point 18) — never more, never fewer. No
 * `evidenceKey`, no `observedValue`, no `sourceRefs`, no `eventType`: a
 * no_evidence result is never eventType/neutral/contradiction/pattern
 * evidence, it is the explicit absence of a usable relationship.
 */
export interface RecommendationVsActualNoEvidence {
  readonly kind: "no_evidence";
  readonly detectorRuleId: RecommendationVsActualRuleId;
  readonly detectorRuleVersion: string;
  readonly evaluationKey: string;
  readonly eventDate: string;
  readonly reason: NoEvidenceReason;
}

/** Canonical public result type — the one name every consumer imports. */
export type RecommendationVsActualDetection = RecommendationVsActualEvidence | RecommendationVsActualNoEvidence;
