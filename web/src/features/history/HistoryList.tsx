import { Link } from "react-router-dom";
import { formatCalendarDate, formatLocalTime } from "../../lib/date";
import { CONFIDENCE_LABELS, DECISION_LABELS, formatIntervention } from "../dailyPlan/dailyPlanLabels";
import type { Confidence } from "../dailyPlan/dailyPlanTypes";
import { COMPLETION_STATUS_LABELS, type CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { summarizeDecision } from "./historySummary";
import type { DecisionHistoryRow } from "./historyTypes";

// Pure presentational list — loading/empty/error states are the caller's
// (HistoryPage) responsibility. Decisions are append-only: several rows
// can share the same decisionDate, and none are deduplicated here — the
// time is shown only for rows that actually need it to stay distinct.
//
// V0.3_007D — `linkedSessions` (decision id -> its EXACTLY linked
// completed_sessions row, see historyPerformedMatch.ts#buildLinkedSessionsByDecisionId)
// drives a compact status badge. A decision absent from this map gets no
// badge at all — including when a same-day session exists but belongs to a
// *different* decision (never inferred from date alone).
export function HistoryList({ rows, linkedSessions }: { rows: DecisionHistoryRow[]; linkedSessions: Map<string, CompletedSessionRecord> }) {
  const sameDayCounts = new Map<string, number>();
  for (const row of rows) {
    sameDayCounts.set(row.decisionDate, (sameDayCounts.get(row.decisionDate) ?? 0) + 1);
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const summary = summarizeDecision(row);
        const needsTime = (sameDayCounts.get(row.decisionDate) ?? 0) > 1;
        const linkedSession = linkedSessions.get(row.id);

        return (
          <li key={row.id}>
            <Link to={`/history/${row.id}`} className="block rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {formatCalendarDate(row.decisionDate)}
                  {needsTime && <span className="normal-case"> · {formatLocalTime(row.createdAt)}</span>}
                </p>
                {linkedSession && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                    {COMPLETION_STATUS_LABELS[linkedSession.completion_status]}
                  </span>
                )}
              </div>

              {summary.valid ? (
                <>
                  <p className="mt-1 font-semibold text-gray-900">{DECISION_LABELS[summary.dailyPlan.decision] ?? summary.dailyPlan.decision}</p>
                  <p className="text-sm text-gray-500">
                    Confiance {(CONFIDENCE_LABELS[summary.dailyPlan.confidence] ?? summary.dailyPlan.confidence).toLowerCase()}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-700">{formatIntervention(summary.dailyPlan.final_session)}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-gray-500">Cette ancienne décision ne peut pas être affichée complètement.</p>
                  {row.confidenceLevelDb && (
                    <p className="text-sm text-gray-500">
                      Confiance {(CONFIDENCE_LABELS[row.confidenceLevelDb as Confidence] ?? row.confidenceLevelDb).toLowerCase()}
                    </p>
                  )}
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
