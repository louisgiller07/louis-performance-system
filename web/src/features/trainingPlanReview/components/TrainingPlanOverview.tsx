import { Card } from "../../../components/Card";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";
import { humanizeLabel, formatShortDate } from "../trainingPlanReviewFormat";
import { describeRelaxedConstraints } from "../placementReasonLabels";
import { translateExplanation } from "../trainingPlanExplanationLabels";
interface TrainingPlanOverviewProps {
  review: TrainingPlanReview;
  /**
   * V06-02 — program days the athlete has overridden in their planning
   * (findAthleteModifiedProgramDates). `null`/absent = unknown (not loaded,
   * not applicable, or the read failed) and renders nothing, exactly like
   * an empty list.
   */
  athleteModifiedDates?: readonly string[] | null;
}

function modifiedDaysMessage(count: number): string {
  return count > 1
    ? `${count} jours de ce programme ont été modifiés par toi dans ton planning.`
    : "1 jour de ce programme a été modifié par toi dans ton planning.";
}

/**
 * UX-06 — the plan's coach summary, shown folded inside Programme's "Résumé
 * du coach": period, the plan's explanation, block focus, overall volume,
 * attention points and the athlete-modified days. The acceptance flow
 * (AcceptTrainingPlanButton) moved to Programme's draft card
 * (ProgramDraftSummary), the lifecycle badge and "Aller à Aujourd'hui" were
 * removed (the tab bar covers it), and "Modifier ma configuration" sits at
 * the bottom of Programme.
 *
 * Deliberately never renders inputSnapshot, plannerVersion/rulesetVersion/
 * catalogVersion/prescriptionSchemaVersion, generationRequestId, or any
 * other internal id/hash — none of these are even part of
 * TrainingPlanReviewVersion's type (V0.5_027 already excluded them at the
 * repository layer), so there is nothing here that could accidentally leak
 * them.
 */
export function TrainingPlanOverview({ review, athleteModifiedDates = null }: TrainingPlanOverviewProps) {
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
  const attentionPoints = describeRelaxedConstraints(review.version.relaxedConstraints);
  // REV-013 — the stored English rationale is translated for display only.
  const versionExplanation = translateExplanation(review.version.rationale, "version").text;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink/80">
        {`Du ${formatShortDate(review.version.horizonStartDate)} au ${formatShortDate(review.version.horizonEndDate)} — ${weekCount} semaine${weekCount > 1 ? "s" : ""}`}
      </p>

      {athleteModifiedDates && athleteModifiedDates.length > 0 && (
        <Card className="flex flex-col gap-1">
          <p className="text-sm font-medium text-ink">{modifiedDaysMessage(athleteModifiedDates.length)}</p>
          <p className="text-xs text-muted">{athleteModifiedDates.map(formatShortDate).join(" · ")}</p>
          <p className="text-xs text-muted">Pour ces jours, ta semaine suit tes modifications.</p>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        {versionExplanation && <p className="text-sm text-ink/90">{versionExplanation}</p>}
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

      {/* V06-04 — engine reasons are never shown raw: describeRelaxedConstraints turns them into counted French sentences. */}
      {attentionPoints.length > 0 && (
        <Card className="flex flex-col gap-1">
          <p className="text-sm font-medium text-ink">Points d'attention</p>
          {attentionPoints.map((text) => (
            <p key={text} className="text-xs text-muted">
              {text}
            </p>
          ))}
        </Card>
      )}

    </div>
  );
}
