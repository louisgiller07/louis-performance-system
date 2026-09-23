import { PlanSection } from "../../../components/PlanSection";
import { Badge } from "../../../components/Badge";
import type { TrainingPlanReviewWeek } from "../trainingPlanReviewTypes";
import { humanizeLabel, formatShortDate } from "../trainingPlanReviewFormat";
import { TrainingPlanSessionCard } from "./TrainingPlanSessionCard";

/** One week: number, dates, type, rationale, dose summary, and its sessions — never a week's sessions rendered anywhere else (ticket lock: the accept action stays exclusively in TrainingPlanOverview). */
export function TrainingPlanWeekCard({ week }: { week: TrainingPlanReviewWeek }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          Semaine {week.weekNumber} — {formatShortDate(week.startDate)} → {formatShortDate(week.endDate)}
        </span>
        <Badge tone="gold">{humanizeLabel(week.weekType)}</Badge>
      </div>

      <p className="text-sm text-ink/80">{week.rationale}</p>

      <PlanSection title="Volume">
        <p>
          {week.doseSummary.plannedStrengthSessionCount} force · {week.doseSummary.plannedDhTechnicalSessionCount} DH ·{" "}
          {week.doseSummary.plannedAerobicSessionCount} aérobie · {week.doseSummary.plannedRestOrRecoveryDayCount} repos
        </p>
        <p className="text-muted">{week.doseSummary.totalPlannedMinutes} min au total</p>
      </PlanSection>

      <div className="flex flex-col gap-2">
        {week.sessions.map((session) => (
          <TrainingPlanSessionCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}
