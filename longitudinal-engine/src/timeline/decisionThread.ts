import type {
  DailyCheckinSource,
  CompletedSessionSource,
  DecisionOutcomeHorizon,
  DecisionOutcomeSource,
  DecisionSource,
} from "../types/sources.js";
import type { DecisionOutcomesByHorizon, DecisionThread } from "./types.js";
import { resolveLink } from "./linking.js";
import { indexById, groupByNullableKey } from "./partitioning.js";
import { sortedBy } from "./ordering.js";
import { DECISION_OUTCOME_HORIZONS } from "./constants.js";

/**
 * `decision_outcomes.decision_id` is NOT NULL, and M5_002A's own range
 * contract anchors an outcome's range membership to its source decision's
 * `decision_date`. An outcome whose `decisionId` cannot resolve against the
 * supplied (range-scoped, see buildTimeline.ts) decision pool is therefore
 * not a normal "link points outside the range" case (that's what Link<T>'s
 * `source_missing_in_pool` models for genuinely nullable FKs) — it is
 * inconsistent input: a fact that claims to observe a decision this range's
 * decision pool doesn't contain. This deliberately also catches the
 * pathological case where the referenced decision IS present in the raw
 * `sources.decisions` array but its `decisionDate` falls outside `range` —
 * from this range's perspective that decision is still not in the pool.
 * No source fact may disappear silently, so this fails loud instead of
 * quietly dropping the outcome.
 */
export class OrphanedDecisionOutcomeError extends Error {
  constructor(outcomeId: string, decisionId: string) {
    super(
      `OrphanedDecisionOutcomeError: decision_outcome ${outcomeId} references decisionId "${decisionId}", ` +
        "which is not present in the supplied decision pool"
    );
    this.name = "OrphanedDecisionOutcomeError";
  }
}

function buildOutcomesByHorizon(outcomes: readonly DecisionOutcomeSource[]): DecisionOutcomesByHorizon {
  const sorted = sortedBy(outcomes, (o) => o.calculatedAt, (o) => o.calculatorId, (o) => o.calculatorVersion, (o) => o.id);
  const byHorizon = Object.fromEntries(
    DECISION_OUTCOME_HORIZONS.map((horizon) => [horizon, [] as DecisionOutcomeSource[]])
  ) as Record<DecisionOutcomeHorizon, DecisionOutcomeSource[]>;
  for (const outcome of sorted) byHorizon[outcome.horizon].push(outcome);
  return byHorizon;
}

/**
 * Builds one DecisionThread per decision (never collapsed/deduplicated —
 * every append-only decision gets its own thread), sorted by
 * decisionDate ASC, computedAt ASC, id ASC.
 *
 * `decisions`, `checkinsById`, and `completedSessions` are expected to
 * already be the caller's range-scoped pools (buildTimeline.ts's job, not
 * this function's) — this function has no `range` of its own and simply
 * builds one thread per decision it is handed, resolving links only
 * against exactly the pools it was given.
 */
export function buildDecisionThreads(
  decisions: readonly DecisionSource[],
  checkinsById: ReadonlyMap<string, DailyCheckinSource>,
  completedSessions: readonly CompletedSessionSource[],
  outcomes: readonly DecisionOutcomeSource[]
): readonly DecisionThread[] {
  const decisionsById = indexById(decisions);

  for (const outcome of outcomes) {
    if (!decisionsById.has(outcome.decisionId)) {
      throw new OrphanedDecisionOutcomeError(outcome.id, outcome.decisionId);
    }
  }

  const completedSessionsByDecisionId = groupByNullableKey(completedSessions, (s) => s.decisionId);
  const outcomesByDecisionId = groupByNullableKey(outcomes, (o) => o.decisionId);

  return sortedBy(decisions, (d) => d.decisionDate, (d) => d.computedAt, (d) => d.id).map((decision) => ({
    decision,
    decisionDate: decision.decisionDate,
    linkedSourceCheckin: resolveLink(decision.sourceCheckinId, checkinsById),
    linkedCompletedSessions: sortedBy(completedSessionsByDecisionId.get(decision.id) ?? [], (s) => s.id),
    outcomesByHorizon: buildOutcomesByHorizon(outcomesByDecisionId.get(decision.id) ?? []),
  }));
}
