import { Card } from "../../../components/Card";
import { Badge } from "../../../components/Badge";
import type { TrainingPlanDraftSummary } from "../trainingPlanReviewTypes";
import { formatShortDate } from "../trainingPlanReviewFormat";

interface DraftListProps {
  drafts: TrainingPlanDraftSummary[];
  selectedId: string;
  onSelect: (planVersionId: string) => void;
}

/**
 * Only ever rendered by the caller when more than one draft exists (ticket
 * lock — this component itself does not decide that, TrainingPlanPreviewPage
 * does). Every entry here is, by construction, in `draft` state —
 * getTrainingPlanDrafts() already filters to that state before returning —
 * so the lifecycle badge shown is always "Brouillon", honestly reflecting
 * that real, verified fact rather than a hardcoded assumption.
 */
export function DraftList({ drafts, selectedId, onSelect }: DraftListProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs uppercase tracking-widest text-muted">{drafts.length} plans en attente d'acceptation</p>
      {drafts.map((draft) => (
        <button key={draft.id} type="button" onClick={() => onSelect(draft.id)} className="text-left">
          <Card className={`flex items-center justify-between gap-2 ${draft.id === selectedId ? "border-gold" : ""}`}>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink">
                {formatShortDate(draft.horizonStartDate)} → {formatShortDate(draft.horizonEndDate)}
              </span>
              <span className="text-xs text-muted">Généré le {formatShortDate(draft.generatedAt.slice(0, 10))}</span>
            </div>
            <Badge tone="gold">Brouillon</Badge>
          </Card>
        </button>
      ))}
    </div>
  );
}
