import { Link } from "react-router-dom";
import { formatCalendarDate, formatLocalTime } from "../../lib/date";
import { CONFIDENCE_LABELS, DECISION_LABELS, formatIntervention } from "../dailyPlan/dailyPlanLabels";
import type { Confidence } from "../dailyPlan/dailyPlanTypes";
import { summarizeDecision } from "./historySummary";
import type { DecisionHistoryRow } from "./historyTypes";

// Pure presentational list — loading/empty/error states are the caller's
// (HistoryPage) responsibility. Decisions are append-only: several rows
// can share the same decisionDate, and none are deduplicated here — the
// time is shown only for rows that actually need it to stay distinct.
export function HistoryList({ rows }: { rows: DecisionHistoryRow[] }) {
  const sameDayCounts = new Map<string, number>();
  for (const row of rows) {
    sameDayCounts.set(row.decisionDate, (sameDayCounts.get(row.decisionDate) ?? 0) + 1);
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const summary = summarizeDecision(row);
        const needsTime = (sameDayCounts.get(row.decisionDate) ?? 0) > 1;

        return (
          <li key={row.id}>
            <Link to={`/history/${row.id}`} className="block rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {formatCalendarDate(row.decisionDate)}
                {needsTime && <span className="normal-case"> · {formatLocalTime(row.createdAt)}</span>}
              </p>

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
