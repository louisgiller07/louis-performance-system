/**
 * M2_004 — `completed_sessions.intervention` JSONB → `TrainingIntervention | null` boundary.
 *
 * See docs/05_DATA_MODEL.md §completed_sessions (audit DDL 2026-08-14,
 * M2_004 REQUIRED). Pure translation/validation layer — no coaching logic.
 *
 * Unlike `planned_sessions.session_type`, there is no canonical, documented
 * deterministic inversion table for `completed_sessions` legacy rows:
 * `main_content` is a free-form JSONB with no established convention, and
 * `session_type` alone is exactly as ambiguous here as it is for
 * `planned_sessions`' ambiguous cases. So there is no fallback at all —
 * `intervention = NULL` (or the key missing) always maps to `null`, never
 * inferred from `main_content`, `session_type`, or any other column.
 *
 * Reuses {@link parseTrainingIntervention} (introduced in M2_003) rather
 * than duplicating validation logic.
 */
import type { TrainingIntervention } from "../../types/index.js";
import { parseTrainingIntervention } from "./parseTrainingIntervention.js";

/** Raw shape of the `completed_sessions` column needed for this mapping. */
export interface CompletedSessionInterventionRow {
  intervention?: unknown;
}

/**
 * Maps `completed_sessions.intervention` to a M1 `TrainingIntervention`.
 *
 * - Present and valid → validated via {@link parseTrainingIntervention}.
 * - `NULL` or absent → `null`, with no fallback attempted.
 * - Present but invalid → throws {@link InvalidTrainingInterventionJsonError}.
 */
export function mapCompletedSessionIntervention(
  row: CompletedSessionInterventionRow
): TrainingIntervention | null {
  if (row.intervention === null || row.intervention === undefined) {
    return null;
  }
  return parseTrainingIntervention(row.intervention);
}
