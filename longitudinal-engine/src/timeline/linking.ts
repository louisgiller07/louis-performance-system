import type { Link } from "./types.js";

/**
 * Resolves a nullable foreign key against a pool of candidate rows keyed
 * by id. `fk_null` when the FK column itself is null (no relationship was
 * ever recorded — e.g. a completed session logged with no decision_id).
 * `source_missing_in_pool` when the FK is non-null but no row with that id
 * exists in the supplied pool — the normal, expected shape for a link that
 * points outside the requested date range, never an error by itself.
 *
 * Only used for the three genuinely nullable FKs this package models as a
 * Link: CompletedSessionOnDay.linkedDecision, DecisionThread.linkedSourceCheckin,
 * HealthFlagThread.linkedSourceCheckin. decision_outcomes.decisionId is
 * NOT NULL and is deliberately never resolved through this function — see
 * decisionThread.ts's fail-loud OrphanedDecisionOutcomeError instead.
 */
export function resolveLink<T>(fk: string | null, pool: ReadonlyMap<string, T>): Link<T> {
  if (fk === null) return { kind: "absent", reason: "fk_null" };
  const ref = pool.get(fk);
  if (ref === undefined) return { kind: "absent", reason: "source_missing_in_pool" };
  return { kind: "explicit", ref };
}
