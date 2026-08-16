/**
 * `completed_sessions` row → M1 `CompletedSessionSummary`. See
 * docs/05_DATA_MODEL.md §completed_sessions and docs/06_ARCHITECTURE.md
 * §Fallback d'intervention en lecture ("symétriquement pour
 * completed_sessions... la session ne contribue pas à recent_load").
 *
 * `CompletedSessionSummary.intervention` is required (non-optional) —
 * unlike `planned_sessions`, there is no legacy fallback table for
 * `completed_sessions` (M2_004 decision). A row whose `intervention`
 * cannot be resolved (NULL/absent, no fallback exists) therefore cannot
 * become a `CompletedSessionSummary` at all: this mapper returns `null`
 * and the caller must exclude it from `recent_sessions`, never fabricate
 * a `kind`/`load_profile` to force a value in.
 */
import type { CompletedSessionSummary } from "../../types/index.js";
import { mapCompletedSessionIntervention } from "./completedSessionIntervention.js";
import type { CompletedSessionRawRow } from "../repositories/completedSessionsRepo.js";

export class InvalidCompletedSessionRowError extends Error {
  constructor(reason: string, value: unknown) {
    super(`Invalid completed_sessions row: ${reason} (${JSON.stringify(value)})`);
    this.name = "InvalidCompletedSessionRowError";
  }
}

/**
 * Returns `null` when the row has no recoverable `TrainingIntervention`
 * (see module doc) — the row is excluded from `recent_sessions`, not
 * defaulted. Throws {@link InvalidCompletedSessionRowError} if
 * `session_date` is missing, and propagates
 * {@link InvalidTrainingInterventionJsonError} if `intervention` is
 * present but malformed (never silently discarded).
 */
export function mapCompletedSessionRow(row: CompletedSessionRawRow): CompletedSessionSummary | null {
  if (typeof row.session_date !== "string") {
    throw new InvalidCompletedSessionRowError("session_date is missing or not a string", row);
  }

  const intervention = mapCompletedSessionIntervention({ intervention: row.intervention });
  if (intervention === null) return null;

  return { date: row.session_date, intervention };
}
