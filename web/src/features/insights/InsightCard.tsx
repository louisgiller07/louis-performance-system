import { formatCalendarDate } from "../../lib/date";
import { ReviewControls } from "./ReviewControls";
import { KIND_TITLES, RESPONSE, STATEMENTS, observations } from "./insightsPresentation";
import type { PatternInsightCandidate, PatternInsightReviewDecision } from "./insightsTypes";

export type InsightCardNotice = { kind: "success" | "stale" | "error"; message: string };

interface InsightCardProps {
  candidate: PatternInsightCandidate;
  submitting: boolean;
  notice: InsightCardNotice | null;
  onReview: (decision: PatternInsightReviewDecision, reviewerNote: string | null) => void;
}

const NOTICE_CLASS: Record<InsightCardNotice["kind"], string> = {
  success: "border-gold/40 text-gold",
  stale: "border-line text-ink/85",
  error: "border-red-400/40 text-red-400",
};

// M5_007 / V0.3_001C / UX-10B-2A — one trend NALYNT observed, in a rider's
// words: the web's own sentence for the engine's kind × direction (the
// server title/statement is the fallback for an unknown kind), the number
// of observations and the period, the engine's caveats kept verbatim, and
// the rider's answer. Never raw evidence refs or ids, never a causal claim,
// never "this improves your plan" (a response is feedback only).
export function InsightCard({ candidate, submitting, notice, onReview }: InsightCardProps) {
  const { snapshot, reviewState, currentReview } = candidate;
  const candidateKey = snapshot.detectorRuleId;
  const title = KIND_TITLES[snapshot.insightKind] ?? snapshot.title;
  const statement = STATEMENTS[snapshot.insightKind]?.[snapshot.direction] ?? snapshot.statement;

  return (
    <article aria-label={title} className="ux-enter flex flex-col gap-3 rounded-2xl border border-line bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{title}</p>
      <p className="font-display text-2xl font-extrabold uppercase leading-tight text-ink">{statement}</p>
      <p className="text-sm text-ink/70">
        {`${observations(snapshot.evidenceCount)} · du ${formatCalendarDate(snapshot.firstEventDate)} au ${formatCalendarDate(snapshot.lastEventDate)}`}
      </p>

      {snapshot.caveats.length > 0 && (
        <ul className="flex flex-col gap-1 border-l border-gold/40 pl-3 text-xs text-muted">
          {snapshot.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}

      {currentReview && (
        <div className="rounded-lg border border-line bg-bg/40 p-3 text-sm">
          <p className="text-ink/85">{RESPONSE.answered(currentReview.decision)}</p>
          {currentReview.reviewerNote && <p className="mt-1 text-ink/70">{currentReview.reviewerNote}</p>}
          {reviewState === "reviewed_stale" && <p className="mt-2 text-gold">{RESPONSE.stale}</p>}
        </div>
      )}

      {notice && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${NOTICE_CLASS[notice.kind]}`}>
          {notice.message}
        </p>
      )}

      <ReviewControls candidateKey={candidateKey} disabled={submitting} onReview={onReview} />
    </article>
  );
}
