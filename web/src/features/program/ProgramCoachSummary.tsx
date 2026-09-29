import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import { TrainingPlanOverview } from "../trainingPlanReview/components/TrainingPlanOverview";
import { TrainingPlanWeekCard } from "../trainingPlanReview/components/TrainingPlanWeekCard";

// UX-06 — everything that explains the plan but is not needed to know where
// you are going, where you stand and what to do: folded by default. The
// content itself is unchanged (plan explanation, block focus, volume,
// attention points, athlete-modified days, every week in full).
export function ProgramCoachSummary({ review, athleteModifiedDates }: { review: TrainingPlanReview; athleteModifiedDates: readonly string[] | null }) {
  return (
    <details className="group rounded-xl border border-line bg-card/60">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">Résumé du coach</span>
          <span className="mt-1 block text-sm text-ink/80">Voir les détails du plan</span>
        </span>
        <span className="text-gold transition-transform duration-300 group-open:rotate-90" aria-hidden="true">
          →
        </span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-line p-4">
        <TrainingPlanOverview review={review} athleteModifiedDates={athleteModifiedDates} />
        {review.blocks
          .flatMap((block) => block.weeks)
          .map((week) => (
            <TrainingPlanWeekCard key={week.id} week={week} />
          ))}
      </div>
    </details>
  );
}
