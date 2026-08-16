/**
 * M2_003 — `planned_sessions` row → `{ planned_session, planned_intent }` boundary.
 *
 * See docs/05_DATA_MODEL.md §planned_sessions and docs/06_ARCHITECTURE.md
 * §Fallback d'intervention en lecture. Pure translation/validation layer —
 * no coaching logic. Two sources, in priority order:
 *
 * 1. `intervention` JSONB present (not null/undefined) → validated via
 *    {@link parseTrainingIntervention} and used as the source of truth.
 *    An invalid JSON shape throws {@link InvalidTrainingInterventionJsonError}
 *    rather than being silently discarded or coerced.
 * 2. `intervention` absent (legacy row) → {@link invertDbSessionType} is
 *    tried. For the three unambiguous fixed-load kinds (`REST`,
 *    `BIKE_MAINTENANCE`, `RACE_PREP`) this yields a real
 *    `TrainingIntervention`. For every other `DbSessionType`, inversion is
 *    mathematically ambiguous: `planned_session` is left `null` and an
 *    explicit warning is emitted — never a fabricated `kind` or
 *    `load_profile`.
 *
 * `planned_intent` preserves the SQL NULL boundary explicitly: an explicit
 * string column value maps to that same string, and a SQL `NULL` (or a
 * missing key, treated the same way — unknown) maps to `null`. It is never
 * derived from `primary_objective`, `session_type`, or the resolved
 * intervention.
 */
import type { DbSessionType, TrainingIntervention } from "../../types/index.js";
import { parseTrainingIntervention } from "./parseTrainingIntervention.js";
import { invertDbSessionType } from "./invertDbSessionType.js";

/** Raw shape of the columns of a `planned_sessions` row needed for this mapping. */
export interface PlannedSessionRow {
  session_type: DbSessionType;
  intervention?: unknown;
  planned_intent?: unknown;
}

export interface PlannedSessionMapping {
  planned_session: TrainingIntervention | null;
  planned_intent: string | null;
  /** Explicit signals for cases where no reliable TrainingIntervention could be reconstructed. */
  warnings: string[];
}

export function mapPlannedSessionRow(row: PlannedSessionRow): PlannedSessionMapping {
  const warnings: string[] = [];
  let planned_session: TrainingIntervention | null;

  if (row.intervention !== null && row.intervention !== undefined) {
    planned_session = parseTrainingIntervention(row.intervention);
  } else {
    planned_session = invertDbSessionType(row.session_type);
    if (planned_session === null) {
      warnings.push(
        `planned_sessions.session_type "${row.session_type}" has no intervention JSONB and cannot be ` +
          "unambiguously inverted to a TrainingIntervention — planned_session left null (see " +
          "docs/05_DATA_MODEL.md §planned_sessions and docs/06_ARCHITECTURE.md §Fallback d'intervention " +
          "en lecture). The engine falls back to M1 T6.1 inference."
      );
    }
  }

  const planned_intent = typeof row.planned_intent === "string" ? row.planned_intent : null;

  return {
    planned_session,
    planned_intent,
    warnings,
  };
}
