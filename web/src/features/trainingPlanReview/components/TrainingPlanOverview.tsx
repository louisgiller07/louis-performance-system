import { Link } from "react-router-dom";
import { Card } from "../../../components/Card";
import { Badge } from "../../../components/Badge";
import { SectionHeader } from "../../../components/SectionHeader";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SecondaryButton } from "../../../components/SecondaryButton";
import type { TrainingPlanLifecycleState, TrainingPlanReview } from "../trainingPlanReviewTypes";
import { humanizeLabel, formatShortDate } from "../trainingPlanReviewFormat";
import { AcceptTrainingPlanButton } from "./AcceptTrainingPlanButton";
import type { AcceptTrainingPlanResponse } from "../acceptTrainingPlan";

const LIFECYCLE_LABEL: Record<TrainingPlanLifecycleState, string> = {
  draft: "Plan prêt à être accepté",
  accepted: "Plan actif",
  superseded: "Remplacé par une version plus récente",
  abandoned: "Abandonné",
};

const LIFECYCLE_TONE: Record<TrainingPlanLifecycleState, "gold" | "green" | "muted"> = {
  draft: "gold",
  accepted: "green",
  superseded: "muted",
  abandoned: "muted",
};

interface TrainingPlanOverviewProps {
  review: TrainingPlanReview;
  hasActivePlan: boolean;
  onAccepted: (result: AcceptTrainingPlanResponse) => void;
}

/**
 * The general/summary view: period, global rationale, volume summary,
 * domain split, the lifecycle state, and the only two actions this whole
 * page exposes at this level — "Accepter" (via AcceptTrainingPlanButton,
 * never rendered anywhere else) and "Modifier ma configuration" (a plain
 * navigation link, never an automatic regeneration — ticket lock).
 *
 * Deliberately never renders inputSnapshot, plannerVersion/rulesetVersion/
 * catalogVersion/prescriptionSchemaVersion, generationRequestId, or any
 * other internal id/hash — none of these are even part of
 * TrainingPlanReviewVersion's type (V0.5_027 already excluded them at the
 * repository layer), so there is nothing here that could accidentally leak
 * them.
 */
export function TrainingPlanOverview({ review, hasActivePlan, onAccepted }: TrainingPlanOverviewProps) {
  const weeks = review.blocks.flatMap((block) => block.weeks);
  const weekCount = weeks.length;
  const totals = weeks.reduce(
    (acc, week) => ({
      strength: acc.strength + week.doseSummary.plannedStrengthSessionCount,
      dh: acc.dh + week.doseSummary.plannedDhTechnicalSessionCount,
      aerobic: acc.aerobic + week.doseSummary.plannedAerobicSessionCount,
      rest: acc.rest + week.doseSummary.plannedRestOrRecoveryDayCount,
      minutes: acc.minutes + week.doseSummary.totalPlannedMinutes,
    }),
    { strength: 0, dh: 0, aerobic: 0, rest: 0, minutes: 0 }
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Ton plan d'entraînement"
        subtitle={`Du ${formatShortDate(review.version.horizonStartDate)} au ${formatShortDate(review.version.horizonEndDate)} — ${weekCount} semaine${weekCount > 1 ? "s" : ""}`}
      />

      <Badge tone={LIFECYCLE_TONE[review.lifecycleState]}>{LIFECYCLE_LABEL[review.lifecycleState]}</Badge>

      {/*
       * Persisted lifecycle, never local click state — so it survives a
       * refresh. "accepted" is always the current plan: accepting another
       * version atomically moves this one to "superseded"
       * (accept_training_plan_version RPC).
       */}
      {review.lifecycleState === "accepted" && (
        <Link to="/today">
          <PrimaryButton className="w-full">Aller à Aujourd'hui</PrimaryButton>
        </Link>
      )}

      <Card className="flex flex-col gap-2">
        <p className="text-sm text-ink/90">{review.version.rationale}</p>
        {review.blocks.map((block) => (
          <p key={block.id} className="text-xs text-muted">
            {block.name} — {humanizeLabel(block.primaryFocus)}
          </p>
        ))}
      </Card>

      <Card className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">Volume global</p>
        <p className="text-sm text-ink/80">
          {totals.strength} force · {totals.dh} DH · {totals.aerobic} aérobie · {totals.rest} repos
        </p>
        <p className="text-xs text-muted">{totals.minutes} min au total</p>
      </Card>

      {review.version.relaxedConstraints.length > 0 && (
        <Card className="flex flex-col gap-1">
          <p className="text-sm font-medium text-ink">Points d'attention</p>
          {review.version.relaxedConstraints.map((constraint, index) => (
            <p key={index} className="text-xs text-muted">
              {constraint.reason}
            </p>
          ))}
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <AcceptTrainingPlanButton review={review} hasActivePlan={hasActivePlan} onAccepted={onAccepted} />
        <Link to="/performance-setup">
          <SecondaryButton className="w-full">Modifier ma configuration</SecondaryButton>
        </Link>
      </div>
    </div>
  );
}
