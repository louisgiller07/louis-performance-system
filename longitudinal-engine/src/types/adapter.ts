import type {
  CompletedSessionSource,
  DailyCheckinSource,
  DecisionOutcomeSource,
  DecisionSource,
  HealthFlagSource,
} from "./sources.js";

/**
 * Inclusive date range — both `fromDate` and `toDate` are included,
 * matching a plain SQL `BETWEEN`. Deliberately explicit rather than an
 * ambiguous "last N days" parameter: the caller (future server-side
 * orchestration) computes and owns the actual dates: this package never
 * invents "today" or a relative window internally.
 */
export interface DateRange {
  /** date, "YYYY-MM-DD", inclusive. */
  fromDate: string;
  /** date, "YYYY-MM-DD", inclusive. */
  toDate: string;
}

/**
 * Read-only source access for one athlete over a bounded date range.
 *
 * Every method:
 *   - is scoped to exactly one `athleteId`, passed explicitly by the
 *     caller — this package never reads "all athletes" as a normal
 *     operation, and never resolves ownership itself (that is a future
 *     server-side orchestration concern, e.g. resolving the caller's own
 *     athlete from their JWT before ever reaching this layer).
 *   - takes an inclusive `DateRange` — see its own doc.
 *   - returns rows in a stable, deterministic order (documented per
 *     implementation — see supabase/adapter.ts).
 *   - performs SELECT only. No implementation of this interface may
 *     INSERT/UPDATE/DELETE or call any persistence RPC
 *     (`persist_daily_run`/`persist_completed_session`/
 *     `persist_decision_outcome`) — this is a source reader, not a writer.
 *
 * `getDecisionOutcomes`/`getHealthFlags` are bounded by the range column
 * documented on their own JSDoc below — neither table has a single
 * "the" date column with the same meaning as `checkin_date`/`session_date`.
 */
export interface LongitudinalSourceAdapter {
  getDailyCheckins(athleteId: string, range: DateRange): Promise<DailyCheckinSource[]>;
  getDecisions(athleteId: string, range: DateRange): Promise<DecisionSource[]>;
  getCompletedSessions(athleteId: string, range: DateRange): Promise<CompletedSessionSource[]>;
  /**
   * Bounded by the related `decisions.decision_date` — an outcome row is
   * about the decision it observes, not about the (possibly much later,
   * possibly replayed) moment its calculator ran. `calculated_at` is an
   * operational timestamp, not the athlete-timeline date this range
   * parameter means. See supabase/adapter.ts for the exact query.
   */
  getDecisionOutcomes(athleteId: string, range: DateRange): Promise<DecisionOutcomeSource[]>;
  /**
   * Bounded by lifecycle overlap, not `flag_date` alone: a flag whose
   * `[flag_date, resolved_at ?? open-ended]` interval intersects `range` is
   * included, even if it was raised before `range.fromDate` and is still
   * unresolved. A flag open across a training block is exactly the signal
   * a longitudinal read of that block needs; `flag_date`-only filtering
   * would silently drop it. See supabase/adapter.ts for the exact query.
   */
  getHealthFlags(athleteId: string, range: DateRange): Promise<HealthFlagSource[]>;
}
