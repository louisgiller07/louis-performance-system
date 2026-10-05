// UX-11R.9 (F-5) — the ONE notion of "the day's session is done" shared by
// Today, the week summary, Programme, the after-session block and History.
// Pure. Same rules as the M1 recent-history bridge
// (head-coach-engine/src/supabase/mapping/recentSessionsForDailyContext.ts)
// and the server invariants (one main session per athlete and day):
// 1. a legacy completed_sessions row that is not `skipped` wins (historical
//    compatibility: its own status is shown);
// 2. otherwise a guided V2 execution with a `completed` event (linked to a
//    decision) makes the day done;
// 3. otherwise the day is not done. A guided execution that is open or
//    abandoned never counts; nothing is inferred from an absent row.
import type { CompletedSessionRecord, CompletionStatus } from "../completedSession/completedSessionTypes";

/** A guided V2 execution that reached `completed` (session_executions + execution_events). */
export interface GuidedCompletion {
  executionId: string;
  sessionDate: string;
  decisionId: string;
  finalPrescriptionId: string | null;
}

export type DayCompletion =
  | { source: "legacy"; date: string; status: Exclude<CompletionStatus, "skipped">; record: CompletedSessionRecord }
  | { source: "guided"; date: string; guided: GuidedCompletion };

/** Most informative legacy status first (same order as Programme's completionOn). */
const LEGACY_ORDER: Exclude<CompletionStatus, "skipped">[] = ["done", "partial", "replaced"];

export function dayCompletion(date: string, legacy: readonly CompletedSessionRecord[], guided: readonly GuidedCompletion[]): DayCompletion | null {
  const rows = legacy.filter((row) => row.session_date === date && row.completion_status !== "skipped");
  for (const status of LEGACY_ORDER) {
    const record = rows.find((row) => row.completion_status === status);
    if (record) return { source: "legacy", date, status, record };
  }
  const execution = guided.find((row) => row.sessionDate === date);
  return execution ? { source: "guided", date, guided: execution } : null;
}

export function isDayDone(date: string, legacy: readonly CompletedSessionRecord[], guided: readonly GuidedCompletion[]): boolean {
  return dayCompletion(date, legacy, guided) !== null;
}

/** A guided V2 completion exists for the date: the legacy debrief is closed for it (server rule completed_session_v2_exists). */
export function hasGuidedCompletion(date: string, guided: readonly GuidedCompletion[]): boolean {
  return guided.some((row) => row.sessionDate === date);
}
