// P0-4 (HPM 2026-10-13) — what History shows of the guided V2 sessions really recorded (session_executions with
// their events and results, read under RLS by the guided-session readers): never rebuilt from the current plan,
// never counted as done unless completed. One status wording for the list and the detail (PHASE_LABELS).
import { PHASE_LABELS } from "../guidedSession/guidedSessionCopy";
import type { ExecutionPhase, ExecutionRow } from "../guidedSession/executionState";
import type { EffectiveExecution } from "../effectiveSession/effectiveDay";
import type { FinalPrescriptionV2State } from "../finalPrescriptionV2/finalPrescriptionV2Types";

/** "Séance guidée terminée / arrêtée / en cours / en pause". */
export const guidedStatusLabel = (phase: ExecutionPhase): string => `Séance guidée ${PHASE_LABELS[phase]}`;

/** PARTIAL-01 — a guided session completed with fewer work sets / passes than its own prescription. */
export const GUIDED_PARTIAL_LABEL = "◐ Séance guidée partiellement réalisée";

/** One recorded attempt of the decision, with its OWN frozen final prescription (null: none linked). */
export interface GuidedAttempt {
  execution: ExecutionRow;
  phase: ExecutionPhase;
  prescription: FinalPrescriptionV2State | null;
}

export interface GuidedRealisation {
  /** Executions started from the decision consulted, oldest first. */
  attempts: GuidedAttempt[];
  /** Other decisions of the same day that have a recorded execution (the detail links to them). */
  otherDecisionIds: string[];
}

/** The day's executions started from `decisionId` (oldest first), and the other decisions of the day that have one. */
export function splitDayExecutions(decisionId: string, executions: readonly ExecutionRow[]): { mine: ExecutionRow[]; otherDecisionIds: string[] } {
  const mine = executions
    .filter((e) => e.decision_id === decisionId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
  const otherDecisionIds = [...new Set(executions.filter((e) => e.decision_id && e.decision_id !== decisionId).map((e) => e.decision_id!))];
  return { mine, otherDecisionIds };
}

/**
 * A guided session of the day that was recorded only partially: "stopped" (every attempt abandoned — results kept,
 * P0-3 O1 included) or "open" (an attempt never finished). Null when a guided session was completed or none exists.
 * Never a completion: dayCompletion.ts, adherence and M1's load are untouched.
 */
export function guidedPartialOf(date: string, executions: readonly EffectiveExecution[]): "stopped" | "open" | null {
  const day = executions.filter((e) => e.sessionDate === date);
  if (day.length === 0 || day.some((e) => e.events.includes("completed"))) return null;
  if (day.some((e) => !e.events.includes("abandoned"))) return "open";
  return "stopped";
}
