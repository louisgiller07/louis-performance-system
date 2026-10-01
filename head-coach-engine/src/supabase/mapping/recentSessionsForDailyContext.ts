/**
 * UX-11B.2.4b — the M1 recent-history bridge (integration layer, pure).
 *
 * Builds `RawContext.recent_sessions` from the legacy `completed_sessions`
 * rows AND the V2 executions completed in the same window, in the exact
 * shape M1 already receives (`CompletedSessionSummary`). M1 never learns the
 * origin. No row is written anywhere: `session_executions` stays the truth of
 * V2 executions, `completed_sessions` the legacy day summary.
 *
 * Rules (ADR UX-11B.2.4):
 * - legacy rows are mapped exactly as before (mapCompletedSessionRow);
 * - one main session per athlete and day (ADR UX-11B.1 §7; completed_sessions
 *   is unique per day and is the day's summary): a date that has a legacy
 *   row takes no V2 entry;
 * - otherwise the completed V2 executions of a date give ONE entry when they
 *   all carry the same intervention (retries / replays of the same session
 *   are never counted twice); if they carry different interventions no
 *   authority says which one the rider did: no entry is chosen, a stable
 *   warning is emitted;
 * - a V2 entry's intervention is its decision's `final_session`; an
 *   execution without one gives no entry (same as a legacy row without
 *   intervention). Its completion status is `done` (a `completed` event);
 * - nothing is ever derived from an ABSENT execution: no `skipped`, no
 *   `replaced` is synthesized.
 * Output sorted by date, then canonical content: same database → same context.
 */
import type { CompletedSessionSummary, TrainingIntervention } from "../../types/index.js";
import { mapCompletedSessionRow } from "./completedSessionRow.js";
import { parseTrainingIntervention } from "./parseTrainingIntervention.js";
import type { CompletedSessionRawRow } from "../repositories/completedSessionsRepo.js";
import type { CompletedExecutionRow } from "../repositories/completedSessionExecutionsRepo.js";

export const RECENT_HISTORY_V2_CONFLICT_WARNING = "recent_history_v2_conflicting_completions";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function mergeRecentSessionsForDailyContext(
  legacyRows: readonly CompletedSessionRawRow[],
  completedExecutions: readonly CompletedExecutionRow[]
): { sessions: CompletedSessionSummary[]; warnings: string[] } {
  const warnings: string[] = [];
  const sessions: CompletedSessionSummary[] = [];
  const legacyDates = new Set<string>();

  for (const row of legacyRows) {
    if (typeof row.session_date === "string") legacyDates.add(row.session_date);
    const mapped = mapCompletedSessionRow(row);
    if (mapped) sessions.push(mapped);
  }

  const v2ByDate = new Map<string, Map<string, TrainingIntervention>>();
  for (const execution of completedExecutions) {
    if (legacyDates.has(execution.sessionDate)) continue;
    if (execution.finalSession === null || execution.finalSession === undefined) continue;
    const intervention = parseTrainingIntervention(execution.finalSession);
    const byContent = v2ByDate.get(execution.sessionDate) ?? new Map<string, TrainingIntervention>();
    byContent.set(canonical(intervention), intervention);
    v2ByDate.set(execution.sessionDate, byContent);
  }
  for (const [date, byContent] of v2ByDate) {
    if (byContent.size === 1) {
      sessions.push({ date, intervention: [...byContent.values()][0]!, completion_status: "done" });
    } else {
      warnings.push(`${RECENT_HISTORY_V2_CONFLICT_WARNING}: ${byContent.size} different completed sessions on ${date}; none counted (no rule says which one was done).`);
    }
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0));
  return { sessions, warnings };
}
