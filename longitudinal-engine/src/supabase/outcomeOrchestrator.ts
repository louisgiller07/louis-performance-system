/**
 * M5_004 — service-role orchestration: the only module in this package that
 * both invokes the pure calculator AND touches Supabase for decision
 * outcomes. It never reloads source facts or rebuilds the timeline (both
 * are the caller's responsibility — same dependency-injection convention as
 * adapter.ts), never INSERTs/UPDATEs/DELETEs decision_outcomes directly,
 * and never writes any other table. The only write path is the existing
 * frozen persist_decision_outcome RPC (M5_001B) — see its own migration for
 * the full security/idempotence contract this module relies on.
 *
 * NO TRIGGER: this file provides a callable capability, not a scheduler, a
 * cron, a daily-run hook, or an Edge Function. See docs/11_DECISION_LOG.md
 * (M5_004) — wiring an actual trigger is explicitly deferred to a later
 * milestone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AthleteTimeline } from "../timeline/types.js";
import { DECISION_OUTCOME_HORIZONS } from "../timeline/constants.js";
import {
  calculateDecisionOutcomeSnapshot,
  targetDateForHorizon,
  isHorizonMature,
  validateObservedThroughDate,
  CALCULATOR_ID,
  CALCULATOR_VERSION,
} from "../calculators/index.js";
import type { DecisionOutcomeHorizon } from "../types/sources.js";

/** >1 persisted decision_outcomes row already matches this exact (decision, horizon, calculator_id, calculator_version) key — the DB's own unique constraint (M5_001B) makes this structurally impossible; surfaced loudly rather than silently picking one. */
export class DuplicatePersistedOutcomeError extends Error {
  constructor(decisionId: string, horizon: string, count: number) {
    super(
      `DuplicatePersistedOutcomeError: found ${count} persisted decision_outcomes rows for decision "${decisionId}" horizon ${horizon} calculator ${CALCULATOR_ID}/${CALCULATOR_VERSION} — expected at most one`
    );
    this.name = "DuplicatePersistedOutcomeError";
  }
}

export interface OutcomeOrchestrationItemError {
  readonly decisionId: string;
  readonly horizon: DecisionOutcomeHorizon;
  readonly error: string;
}

export interface OutcomeOrchestrationResult {
  /** Number of (decision, horizon) pairs the calculator was actually invoked for. */
  readonly attempted: number;
  /**
   * The RPC call completed successfully (persistence was ensured) — this
   * does NOT necessarily mean a fresh INSERT: persist_decision_outcome's
   * own idempotent fast path can also return success for an exact replay
   * that a concurrent writer already inserted after this timeline was
   * loaded. Named writeSucceeded, not "persisted"/"inserted", precisely to
   * avoid that false implication.
   */
  readonly writeSucceeded: number;
  /** Skipped because the supplied timeline's own DecisionThread.outcomesByHorizon already contained exactly one matching (calculator_id, calculator_version) row — no RPC call was made for this item. */
  readonly alreadyExisted: number;
  /** targetDate for this (decision, horizon) is after observedThroughDate — not yet mature, never attempted. */
  readonly skippedImmature: number;
  readonly errors: readonly OutcomeOrchestrationItemError[];
}

export interface CalculateAndPersistOutcomesParams {
  /** service_role client — persist_decision_outcome only, never a second write path. */
  readonly supabaseAdmin: SupabaseClient;
  /** Already built by the caller (adapter + buildTimeline) — never re-fetched or rebuilt here. */
  readonly timeline: AthleteTimeline;
  readonly observedThroughDate: string;
}

/**
 * For every canonical DecisionThread × horizon in the supplied timeline:
 * pre-filters immature horizons by plain date comparison (never by
 * catching the calculator's own defensive HorizonNotMatureError as control
 * flow), short-circuits via the timeline's own already-loaded
 * outcomesByHorizon (no redundant Supabase SELECT — see
 * docs/11_DECISION_LOG.md, M5_004, point 11), then calculates and persists.
 * A single item's failure (calculator error or RPC error) is captured in
 * `errors` and does not abort the batch — the DB/RPC's own uniqueness
 * constraint remains the final concurrency authority regardless.
 *
 * `observedThroughDate` is public runtime input, exactly like it is for the
 * calculator — validated once, up front, before any decision/horizon
 * iteration, any maturity comparison, any existing-outcome short circuit,
 * or any RPC activity. A malformed/impossible date must never be silently
 * absorbed into `skippedImmature` (a plain string comparison against an
 * unvalidated value would happily "succeed" either way) or into a
 * per-item `errors[]` entry — it is a single global caller-input failure,
 * so it throws InvalidObservedThroughDateError directly, the same error
 * identity the calculator itself would raise for the same bad input.
 */
export async function calculateAndPersistOutcomes(params: CalculateAndPersistOutcomesParams): Promise<OutcomeOrchestrationResult> {
  const { supabaseAdmin, timeline, observedThroughDate } = params;
  validateObservedThroughDate(observedThroughDate);
  const athleteId = timeline.athleteId;

  let attempted = 0;
  let writeSucceeded = 0;
  let alreadyExisted = 0;
  let skippedImmature = 0;
  const errors: OutcomeOrchestrationItemError[] = [];

  for (const thread of timeline.decisionThreads) {
    for (const horizon of DECISION_OUTCOME_HORIZONS) {
      const targetDate = targetDateForHorizon(thread.decisionDate, horizon);
      if (!isHorizonMature(targetDate, observedThroughDate)) {
        skippedImmature += 1;
        continue;
      }

      const existing = thread.outcomesByHorizon[horizon].filter(
        (o) => o.calculatorId === CALCULATOR_ID && o.calculatorVersion === CALCULATOR_VERSION
      );
      if (existing.length > 1) {
        errors.push({
          decisionId: thread.decision.id,
          horizon,
          error: new DuplicatePersistedOutcomeError(thread.decision.id, horizon, existing.length).message,
        });
        continue;
      }
      if (existing.length === 1) {
        alreadyExisted += 1;
        continue;
      }

      attempted += 1;
      let calculation;
      try {
        calculation = calculateDecisionOutcomeSnapshot({ timeline, decisionId: thread.decision.id, horizon, observedThroughDate });
      } catch (err) {
        errors.push({ decisionId: thread.decision.id, horizon, error: err instanceof Error ? err.message : String(err) });
        continue;
      }

      const { error } = await supabaseAdmin.rpc("persist_decision_outcome", {
        p_athlete_id: athleteId,
        p_row: {
          decision_id: thread.decision.id,
          horizon,
          calculator_id: CALCULATOR_ID,
          calculator_version: CALCULATOR_VERSION,
          input_snapshot: calculation.inputSnapshot,
          outcome_signals: calculation.outcomeSignals,
        },
      });

      if (error) {
        errors.push({ decisionId: thread.decision.id, horizon, error: `persist_decision_outcome RPC failed: ${error.code ?? error.message}` });
        continue;
      }
      writeSucceeded += 1;
    }
  }

  return { attempted, writeSucceeded, alreadyExisted, skippedImmature, errors };
}
