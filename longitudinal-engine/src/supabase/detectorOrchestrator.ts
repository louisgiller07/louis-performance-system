/**
 * V0.3_001A — batch orchestration for all 3 existing detectors, mirroring
 * `outcomeOrchestrator.ts`'s own shape and discipline exactly: this file
 * NEVER reloads source facts or rebuilds the timeline (the caller's
 * responsibility, same DI convention as `outcomeOrchestrator.ts`/`adapter.ts`),
 * never touches `pattern_evidence_*` tables directly, and delegates 100% of
 * detection/persistence semantics to `detectors/**`/`persistence/**` — it
 * only decides WHICH evaluation units exist and calls `detect()` then
 * `persist()` for each, capturing per-item failures without aborting
 * unrelated units.
 *
 * NO TRIGGER: like `outcomeOrchestrator.ts`, this provides a callable
 * capability, not a scheduler/cron/daily-run hook — wiring an actual
 * caller (the `refresh-longitudinal` Edge Function) is a separate concern.
 *
 * Evaluation units, derived from the real `AthleteTimeline` shape:
 *   - recommendation_vs_actual_execution: one per `timeline.decisionThreads[].decision.id`.
 *   - sleep_quality_to_same_day_energy_correlation /
 *     pain_persistence_across_recent_checkins: one per `timeline.days[]`
 *     entry with exactly one checkin (`day.checkins.length === 1`) — days
 *     with zero checkins have nothing to evaluate; a day with >1 checkin
 *     (structurally near-impossible against real DB uniqueness, but
 *     possible against a malformed synthetic timeline) is left to the
 *     detector's own `DuplicateCheckinDateError`, caught per-item below
 *     like any other structural error.
 *
 * Post-V0.3_001A-correction, all three detectors' persistence adapters
 * share the identical action vocabulary for both branches (evidence:
 * inserted/superseded/unchanged; no_evidence: withdrawn/unchanged_withdrawal/
 * skipped_no_evidence_no_prior) — this orchestrator normalizes all three
 * onto one `DetectorOrchestrationItemResult.action` union, never
 * reinterpreting or duplicating what each adapter already decided.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AthleteTimeline } from "../timeline/types.js";
import {
  detectRecommendationVsActualExecution,
  detectSleepQualityToSameDayEnergyCorrelation,
  detectPainPersistenceAcrossRecentCheckins,
  RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID,
  SLEEP_ENERGY_RULE_ID,
  PAIN_PERSISTENCE_RULE_ID,
} from "../detectors/index.js";
import { persistRecommendationVsActualEvidence, persistSleepEnergyEvidence, persistPainPersistenceEvidence } from "../persistence/index.js";

export type DetectorOrchestrationAction = "evidence_inserted" | "evidence_superseded" | "evidence_unchanged" | "withdrawn" | "unchanged_withdrawal" | "skipped_no_evidence_no_prior";

export interface DetectorOrchestrationItemResult {
  readonly detectorRuleId: string;
  readonly evaluationUnitId: string;
  readonly action: DetectorOrchestrationAction;
}

export interface DetectorOrchestrationItemError {
  readonly detectorRuleId: string;
  readonly evaluationUnitId: string;
  readonly error: string;
}

export interface RunDetectorsParams {
  /** service_role client — the persistence RPCs it calls are all service_role-EXECUTE-only. */
  readonly supabaseAdmin: SupabaseClient;
  /** Already built by the caller (assembleAthleteTimeline + buildTimeline) — never re-fetched or rebuilt here. */
  readonly timeline: AthleteTimeline;
}

export interface DetectorOrchestrationResult {
  readonly attempted: number;
  readonly results: readonly DetectorOrchestrationItemResult[];
  readonly errors: readonly DetectorOrchestrationItemError[];
}

function evidenceActionToOrchestrationAction(evidenceAction: "inserted" | "superseded" | "unchanged"): DetectorOrchestrationAction {
  return evidenceAction === "inserted" ? "evidence_inserted" : evidenceAction === "superseded" ? "evidence_superseded" : "evidence_unchanged";
}

export async function runDetectors(params: RunDetectorsParams): Promise<DetectorOrchestrationResult> {
  const { supabaseAdmin, timeline } = params;
  const athleteId = timeline.athleteId;

  const results: DetectorOrchestrationItemResult[] = [];
  const errors: DetectorOrchestrationItemError[] = [];
  let attempted = 0;

  // recommendation_vs_actual_execution — one per decision thread, in the timeline's own deterministic order.
  for (const thread of timeline.decisionThreads) {
    const decisionId = thread.decision.id;
    attempted += 1;
    try {
      const detection = detectRecommendationVsActualExecution({ timeline, decisionId });
      const outcome = await persistRecommendationVsActualEvidence(supabaseAdmin, { athleteId, detection });
      const action = outcome.kind === "evidence" ? evidenceActionToOrchestrationAction(outcome.evidenceAction) : outcome.action;
      results.push({ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: decisionId, action });
    } catch (err) {
      errors.push({ detectorRuleId: RECOMMENDATION_VS_ACTUAL_EXECUTION_RULE_ID, evaluationUnitId: decisionId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // sleep_quality_to_same_day_energy_correlation / pain_persistence_across_recent_checkins —
  // one per day with exactly one checkin, in the timeline's own deterministic day order.
  for (const day of timeline.days) {
    if (day.checkins.length !== 1) continue;
    const evaluationCheckinId = day.checkins[0]!.id;

    attempted += 1;
    try {
      const detection = detectSleepQualityToSameDayEnergyCorrelation({ timeline, evaluationCheckinId });
      const outcome = await persistSleepEnergyEvidence(supabaseAdmin, { athleteId, detection });
      const action = outcome.kind === "evidence" ? evidenceActionToOrchestrationAction(outcome.evidenceAction) : outcome.action;
      results.push({ detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: evaluationCheckinId, action });
    } catch (err) {
      errors.push({ detectorRuleId: SLEEP_ENERGY_RULE_ID, evaluationUnitId: evaluationCheckinId, error: err instanceof Error ? err.message : String(err) });
    }

    attempted += 1;
    try {
      const detection = detectPainPersistenceAcrossRecentCheckins({ timeline, evaluationCheckinId });
      const outcome = await persistPainPersistenceEvidence(supabaseAdmin, { athleteId, detection });
      const action = outcome.kind === "evidence" ? evidenceActionToOrchestrationAction(outcome.evidenceAction) : outcome.action;
      results.push({ detectorRuleId: PAIN_PERSISTENCE_RULE_ID, evaluationUnitId: evaluationCheckinId, action });
    } catch (err) {
      errors.push({ detectorRuleId: PAIN_PERSISTENCE_RULE_ID, evaluationUnitId: evaluationCheckinId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { attempted, results, errors };
}
