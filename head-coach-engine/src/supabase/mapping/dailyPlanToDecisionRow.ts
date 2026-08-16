/**
 * M2_002 — DailyPlan → `public.decisions` insert row.
 *
 * See docs/05_DATA_MODEL.md §decisions and docs/11_DECISION_LOG.md
 * (2026-08-14 — M2: confidence_level integrated into M2_002).
 *
 * Canonical rules enforced here:
 * - `daily_plan` carries the full DailyPlan as the JSONB source of truth.
 * - `confidence_level` receives the M1 qualitative Confidence verbatim
 *   (LOW→LOW, MEDIUM→MEDIUM, HIGH→HIGH) — never converted to a number.
 * - The legacy `confidence numeric(3,2)` column is never written by this
 *   mapper — it is not part of {@link DecisionInsertRow} at all, so every
 *   M2 row leaves it at NULL (docs/11_DECISION_LOG.md 2026-08-14).
 * - `overridden_by_user` is never written — PostgreSQL's own
 *   `DEFAULT false` applies. Not part of {@link DecisionInsertRow}.
 * - `stop_conditions` is explicitly set to `null`: the DB column default
 *   is `'[]'::jsonb`, but M1 does not produce stop conditions and
 *   docs/05_DATA_MODEL.md §decisions requires the column to stay NULL in
 *   M2, not fall back to '[]'.
 * - Only the denormalized columns explicitly listed in
 *   docs/05_DATA_MODEL.md §decisions (`final_session`,
 *   `planned_session_before`, `reason`, `do_not_do`, `override_reason`,
 *   `engine_version`) are populated alongside the M2 columns — no
 *   additional legacy column (e.g. `triggered_rules`) is filled here,
 *   since the canonical doc does not list it as a DAL responsibility.
 */
import type { DailyPlan, TrainingMode, DbSessionType, Confidence } from "../../types/index.js";
import { mapTrainingInterventionToDbSessionType } from "../../mapping/trainingInterventionToDbSessionType.js";

/** `public.confidence_level` — identical vocabulary to M1's `Confidence`, reused rather than duplicated. */
export type ConfidenceLevel = Confidence;

/**
 * Shape of a row insertable into `public.decisions` for a new M2 decision.
 *
 * Deliberately excludes `confidence` (legacy numeric, never written by M2)
 * and `overridden_by_user` (left to its DB default) — see module doc above.
 */
export interface DecisionInsertRow {
  athlete_id: string;
  decision_date: string;
  planned_session_before: DbSessionType | null;
  final_session: DbSessionType;
  reason: string;
  do_not_do: string[];
  override_reason: string | null;
  engine_version: string;
  stop_conditions: null;
  daily_plan: DailyPlan;
  active_mode: TrainingMode;
  confidence_level: ConfidenceLevel;
}

/**
 * Maps a M1 `DailyPlan` (plus the athlete it was computed for) to a
 * `public.decisions` insert row. Pure function, no I/O, no coaching logic —
 * translation only. See docs/06_ARCHITECTURE.md §Adapter Supabase.
 */
export function mapDailyPlanToDecisionRow(dailyPlan: DailyPlan, athleteId: string): DecisionInsertRow {
  return {
    athlete_id: athleteId,
    decision_date: dailyPlan.date,
    planned_session_before: dailyPlan.planned_session_before
      ? mapTrainingInterventionToDbSessionType(dailyPlan.planned_session_before)
      : null,
    final_session: mapTrainingInterventionToDbSessionType(dailyPlan.final_session),
    reason: dailyPlan.reasoning,
    do_not_do: dailyPlan.protection.do_not_do,
    override_reason: dailyPlan.override_reason ?? null,
    engine_version: dailyPlan.engine_version,
    stop_conditions: null,
    daily_plan: dailyPlan,
    active_mode: dailyPlan.active_mode,
    confidence_level: dailyPlan.confidence,
  };
}
