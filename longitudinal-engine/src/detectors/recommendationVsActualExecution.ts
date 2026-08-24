/**
 * M5_005 — pure, deterministic recommendation-vs-actual-execution detector.
 * Answers only "does the recorded execution support/contradict/neutrally
 * relate to this decision's recommendation" — never "was this a good
 * decision", never a coaching recommendation, never a pattern/aggregate.
 * See docs/11_DECISION_LOG.md (M5_005) for the full design record.
 *
 * No Supabase, no network, no filesystem, no process env, no Date.now(),
 * no randomness, no mutable global state — same purity boundary as
 * calculators/** and relations/**.
 *
 * Consumes ONLY: decision.id / decision.athleteId / decision.decisionDate /
 * decision.finalSession, plus (when the execution relationship is
 * "explicit") execution.completedSessionId / .sessionType /
 * .completionStatus. Never touches dailyPlan, activeMode, checkins, health
 * flags, decision_outcomes, or any other timeline field — see the test
 * suite's "zero consumption" proofs.
 */
import type { AthleteTimeline } from "../timeline/types.js";
import { resolveDecisionThreadById, resolveExecutionRelationship } from "../relations/index.js";
import { AthleteScopeMismatchError, CompletionStatusTypeMismatchError } from "./errors.js";
// Local, module-scoped aliases only — the public names are the longer
// detector-specific RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID/VERSION (see
// constants.ts's own doc for why the package-root names must not be
// generic); this alias never crosses the module boundary.
import { RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID as RULE_ID, RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_VERSION as RULE_VERSION } from "./constants.js";
import type { DetectorEventType, RecommendationVsActualDetection } from "./types.js";

export interface DetectRecommendationVsActualExecutionInput {
  readonly timeline: AthleteTimeline;
  readonly decisionId: string;
}

/**
 * Classification matrix (M5_005 lock, point 13 — exact):
 *   explicit + done    + type match    -> supporting
 *   explicit + partial + type match    -> neutral
 *   explicit + skipped + type match    -> contradicting
 *   explicit + replaced (type match OR mismatch, both valid) -> contradicting
 *   explicit + (done|partial|skipped) + type MISMATCH -> CompletionStatusTypeMismatchError (structural, never evidence)
 *
 * No-evidence matrix (point 14 — exact): no_completed_session /
 * same_day_session_unlinked / same_day_session_linked_elsewhere all map
 * 1:1 to `{ kind: "no_evidence", reason: <same state name> }` — never an
 * eventType, never inferred from matching session types.
 */
export function detectRecommendationVsActualExecution(input: DetectRecommendationVsActualExecutionInput): RecommendationVsActualDetection {
  const { timeline, decisionId } = input;

  const thread = resolveDecisionThreadById(timeline, decisionId);
  if (thread.decision.athleteId !== timeline.athleteId) {
    throw new AthleteScopeMismatchError(decisionId, thread.decision.athleteId, timeline.athleteId);
  }

  const decisionDate = thread.decisionDate;
  const recommendedSessionType = thread.decision.finalSession;
  const evaluationKey = `decision:${thread.decision.id}`;

  // Shared resolver — owns all execution-relationship lookup/consistency logic. Its own (redundant but
  // harmless) decisionId lookup uses the exact same shared primitive as the resolution above.
  const resolution = resolveExecutionRelationship({ timeline, decisionId });

  if (resolution.signal.state !== "explicit") {
    return {
      kind: "no_evidence",
      detectorRuleId: RULE_ID,
      detectorRuleVersion: RULE_VERSION,
      evaluationKey,
      eventDate: decisionDate,
      reason: resolution.signal.state,
    };
  }

  const { completedSessionId, sessionType: actualSessionType, completionStatus } = resolution.signal;
  const typeMatchesRecommendation = actualSessionType === recommendedSessionType;

  let eventType: DetectorEventType;
  switch (completionStatus) {
    case "done":
      if (!typeMatchesRecommendation) {
        throw new CompletionStatusTypeMismatchError(decisionId, completedSessionId, completionStatus, recommendedSessionType, actualSessionType);
      }
      eventType = "supporting";
      break;
    case "partial":
      if (!typeMatchesRecommendation) {
        throw new CompletionStatusTypeMismatchError(decisionId, completedSessionId, completionStatus, recommendedSessionType, actualSessionType);
      }
      eventType = "neutral";
      break;
    case "skipped":
      if (!typeMatchesRecommendation) {
        throw new CompletionStatusTypeMismatchError(decisionId, completedSessionId, completionStatus, recommendedSessionType, actualSessionType);
      }
      eventType = "contradicting";
      break;
    case "replaced":
      // Both a matching and a differing DbSessionType are valid here — never require inequality.
      eventType = "contradicting";
      break;
  }

  return {
    kind: "evidence",
    detectorRuleId: RULE_ID,
    detectorRuleVersion: RULE_VERSION,
    evaluationKey,
    evidenceKey: `decision:${thread.decision.id}:completion:${completedSessionId}`,
    eventType,
    eventDate: decisionDate,
    observedValue: {
      decisionId: thread.decision.id,
      decisionDate,
      recommendedSessionType,
      executionState: "explicit",
      completedSessionId,
      completionStatus,
      actualSessionType,
      typeMatchesRecommendation,
    },
    sourceRefs: {
      decisionId: thread.decision.id,
      completedSessionId,
    },
  };
}
