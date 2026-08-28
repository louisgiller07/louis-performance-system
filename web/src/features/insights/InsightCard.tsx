import { formatCalendarDate } from "../../lib/date";
import { ReviewControls } from "./ReviewControls";
import { DIRECTION_LABELS, REVIEW_DECISION_LABELS, REVIEW_STATE_LABELS } from "./insightsLabels";
import type { PatternInsightCandidate, PatternInsightReviewDecision } from "./insightsTypes";

export interface InsightCardNotice {
  readonly kind: "stale" | "success" | "error";
  readonly message: string;
}

interface InsightCardProps {
  candidate: PatternInsightCandidate;
  submitting: boolean;
  notice: InsightCardNotice | null;
  onReview: (decision: PatternInsightReviewDecision, reviewerNote: string | null) => void;
}

const REVIEW_STATE_BADGE_CLASS: Record<string, string> = {
  unreviewed: "bg-gray-100 text-gray-600",
  reviewed_current: "bg-green-100 text-green-800",
  reviewed_stale: "bg-amber-100 text-amber-800",
};

const NOTICE_CLASS: Record<InsightCardNotice["kind"], string> = {
  stale: "border-amber-300 bg-amber-50 text-amber-800",
  success: "border-green-300 bg-green-50 text-green-800",
  error: "border-red-300 bg-red-50 text-red-700",
};

// M5_007/V0.3_001C — one insight candidate: title/statement/caveats
// (server-authored copy), a minimal evidence summary (counts + first/last
// event date, never raw sourceEvidenceRefs JSON, never
// identity/revision/evaluation/evidence-key UUIDs), current review state,
// and the three explicit review actions. Purely presentational — all
// get-insights/submit-review calls live in insightsRepo.ts, invoked by
// InsightsPage.
export function InsightCard({ candidate, submitting, notice, onReview }: InsightCardProps) {
  const { snapshot, reviewState, currentReview } = candidate;
  const candidateKey = snapshot.detectorRuleId;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">{snapshot.title}</h2>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_STATE_BADGE_CLASS[reviewState]}`}>
          {REVIEW_STATE_LABELS[reviewState]}
        </span>
      </div>

      <p className="text-sm text-gray-700">{snapshot.statement}</p>

      {snapshot.caveats.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-gray-500">
          {snapshot.caveats.map((caveat) => (
            <li key={caveat}>· {caveat}</li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-400">Tendance</dt>
        <dd className="text-gray-900">{DIRECTION_LABELS[snapshot.direction]}</dd>

        <dt className="text-gray-400">Observations</dt>
        <dd className="text-gray-900">
          {snapshot.evidenceCount} au total ({snapshot.supportingCount} pour, {snapshot.contradictingCount} contre, {snapshot.neutralCount} neutres)
        </dd>

        <dt className="text-gray-400">Période</dt>
        <dd className="text-gray-900">
          {formatCalendarDate(snapshot.firstEventDate)} – {formatCalendarDate(snapshot.lastEventDate)}
        </dd>
      </dl>

      {currentReview && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="text-gray-700">
            Revue précédente : <span className="font-medium">{REVIEW_DECISION_LABELS[currentReview.decision]}</span>
          </p>
          {currentReview.reviewerNote && <p className="mt-1 text-gray-600">{currentReview.reviewerNote}</p>}
          {reviewState === "reviewed_stale" && (
            <p className="mt-2 text-amber-700">Cette revue concernait une version antérieure de l'insight. Une nouvelle revue est nécessaire.</p>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className={`rounded border px-3 py-2 text-sm ${NOTICE_CLASS[notice.kind]}`}>
          {notice.message}
        </p>
      )}

      <ReviewControls candidateKey={candidateKey} disabled={submitting} onReview={onReview} />
    </article>
  );
}
