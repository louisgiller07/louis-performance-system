import { Link } from "react-router-dom";
import { formatLocalTime } from "../../lib/date";
import { CONFIDENCE_LABELS, DECISION_LABELS, TRAINING_KIND_LABELS, LOAD_PROFILE_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { ArbitrationDecision, Confidence } from "../dailyPlan/dailyPlanTypes";
import { Badge } from "../../components/Badge";
import { COMPLETION_STATUS_LABELS, type CompletionStatus, type CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { summarizeDecision } from "./historySummary";
import type { DecisionHistoryRow } from "./historyTypes";

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "short" });
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("fr-CH", { month: "short", year: "numeric" });

/** Parses a bare YYYY-MM-DD as a local calendar date — never `new Date(dateString)`, which reads it as UTC midnight and can render the wrong day near a timezone boundary. */
function parseLocalDate(dateISO: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dayNumber(dateISO: string): number {
  return parseLocalDate(dateISO).getDate();
}

// V0.3 UX PREMIUM — presentation-only accent per decision, same vocabulary
// as DecisionHero.tsx (TodayPage) — REPLACE stays gold-family (a normal
// arbitration pivot, not a safety event), red is reserved exclusively for
// REST/SAFETY. Never changes which decision is computed.
const DECISION_ACCENT: Record<ArbitrationDecision, { icon: string; className: string }> = {
  KEEP: { icon: "◎", className: "text-gold" },
  MODIFY: { icon: "◌", className: "text-amber-300" },
  REPLACE: { icon: "↻", className: "text-gold-light" },
  REST: { icon: "", className: "text-red-400" },
};

// V0.3 UX PREMIUM — Phase 3. Presentation only: COMPLETION_STATUS_LABELS
// (the actual displayed text, e.g. "Faite"/"Non faite") is never changed —
// only its icon/tone. `green` is Badge's one narrow exception, used here
// exclusively for the genuinely-completed outcome.
const COMPLETION_STATUS_BADGE: Record<CompletionStatus, { icon: string; tone: "green" | "muted" | "red" }> = {
  done: { icon: "✓", tone: "green" },
  partial: { icon: "◐", tone: "muted" },
  replaced: { icon: "↻", tone: "red" },
  skipped: { icon: "✕", tone: "red" },
};

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
//
// V0.3 UX PREMIUM — rows are already ordered decision_date desc, created_at
// desc (historyRepo.ts), so rows[0] is always the most recent decision —
// the only one that gets the "Dernière séance" gold-highlight treatment
// (Phase 4).
export function HistoryList({ rows, linkedSessions }: { rows: DecisionHistoryRow[]; linkedSessions: Map<string, CompletedSessionRecord> }) {
  const sameDayCounts = new Map<string, number>();
  for (const row of rows) {
    sameDayCounts.set(row.decisionDate, (sameDayCounts.get(row.decisionDate) ?? 0) + 1);
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, index) => {
        const summary = summarizeDecision(row);
        const linkedSession = linkedSessions.get(row.id);
        const isLatest = index === 0;
        const needsTime = (sameDayCounts.get(row.decisionDate) ?? 0) > 1;

        const kindLabel = summary.valid
          ? (TRAINING_KIND_LABELS[summary.dailyPlan.final_session.kind] ?? summary.dailyPlan.final_session.kind)
          : null;
        const loadProfile = summary.valid ? (summary.dailyPlan.final_session.load_profile ?? null) : null;
        const durationMin = summary.valid ? summary.dailyPlan.final_session.duration_min : undefined;
        const decisionAccent = summary.valid ? DECISION_ACCENT[summary.dailyPlan.decision] : null;
        const statusBadge = linkedSession ? COMPLETION_STATUS_BADGE[linkedSession.completion_status] : null;

        return (
          <li key={row.id}>
            <Link
              to={`/history/${row.id}`}
              className={`block rounded-xl border bg-card p-3 active:bg-white/5 ${
                isLatest ? "border-gold shadow-[0_0_12px_1px_rgba(212,175,55,0.2)]" : "border-white/5"
              }`}
            >
              {isLatest && <Badge tone="gold">Dernière séance</Badge>}

              <div className={`flex items-start gap-3 ${isLatest ? "mt-2" : ""}`}>
                {/* Fixed date column */}
                <div className="flex w-12 shrink-0 flex-col items-center border-r border-white/10 pr-3 text-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {WEEKDAY_FORMAT.format(parseLocalDate(row.decisionDate))}
                  </span>
                  <span className="text-2xl font-bold leading-tight text-ink">{dayNumber(row.decisionDate)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted">
                    {MONTH_YEAR_FORMAT.format(parseLocalDate(row.decisionDate))}
                  </span>
                  {/* V0.3_007D — several append-only decisions can share the
                      same date; the time is the only thing that keeps them
                      visually distinct, shown only when actually needed. */}
                  {needsTime && <span className="font-mono text-[10px] text-muted">{formatLocalTime(row.createdAt)}</span>}
                </div>

                {/* Center content */}
                <div className="min-w-0 flex-1">
                  {summary.valid ? (
                    <>
                      <p className="truncate font-semibold uppercase tracking-tight text-ink">{kindLabel}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {loadProfile && <Badge tone="gold">{LOAD_PROFILE_LABELS[loadProfile]}</Badge>}
                        {statusBadge && (
                          <Badge tone={statusBadge.tone}>
                            {statusBadge.icon} {COMPLETION_STATUS_LABELS[linkedSession!.completion_status]}
                          </Badge>
                        )}
                      </div>
                      {durationMin !== undefined && (
                        <p className="mt-1 text-xs text-muted">◷ Durée prévue {durationMin} min</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted">Cette ancienne décision ne peut pas être affichée complètement.</p>
                  )}
                </div>

                {/* Right: decision + confidence */}
                <div className="shrink-0 text-right">
                  {summary.valid ? (
                    <>
                      <p className={`font-semibold ${decisionAccent!.className}`}>
                        {decisionAccent!.icon} {DECISION_LABELS[summary.dailyPlan.decision] ?? summary.dailyPlan.decision}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Confiance {(CONFIDENCE_LABELS[summary.dailyPlan.confidence] ?? summary.dailyPlan.confidence).toLowerCase()}
                      </p>
                    </>
                  ) : (
                    row.confidenceLevelDb && (
                      <p className="text-xs text-muted">
                        Confiance {(CONFIDENCE_LABELS[row.confidenceLevelDb as Confidence] ?? row.confidenceLevelDb).toLowerCase()}
                      </p>
                    )
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
