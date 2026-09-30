import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import { formatShortDate } from "../trainingPlanReview/trainingPlanReviewFormat";
import type { RaceHorizon, TodayRace } from "../today/todayContext";
import { planWeekAt } from "./programPresentation";

// UX-06 — the top of Programme: where the plan is going (race or objective),
// where the athlete is in it ("Semaine N / M" and the stored week type), and
// the brand promise. Only existing data: no invented phase, no score.
export function ProgramHero({
  review,
  horizon,
  objective,
  today,
}: {
  review: TrainingPlanReview;
  horizon: RaceHorizon<TodayRace> | null;
  objective: string | null;
  today: string;
}) {
  const position = planWeekAt(review, today);
  const title = horizon ? `Préparation ${horizon.race.eventName}` : "Ton plan actuel";
  const big = horizon?.kind === "countdown" ? (horizon.days === 1 ? "Demain" : `J-${horizon.days}`) : horizon?.kind === "ongoing" ? `Jour ${horizon.day}` : null;
  const raceLine = horizon?.kind === "ongoing" ? "En course" : horizon?.kind === "horizon" ? "Objectif de saison" : null;

  let progress: string | null = null;
  if (position) {
    progress = [`Semaine ${position.position} / ${position.total}`, position.phase ? `Cette semaine : ${position.phase}` : null].filter(Boolean).join(" · ");
  } else if (today < review.version.horizonStartDate) {
    progress = `Ton plan commence le ${formatShortDate(review.version.horizonStartDate)}`;
  } else if (today > review.version.horizonEndDate) {
    progress = `Plan terminé le ${formatShortDate(review.version.horizonEndDate)}`;
  }

  return (
    <section aria-labelledby="program-title" className="ux-enter ux-grain relative overflow-hidden rounded-2xl border border-gold/40 bg-card p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-gold/10 via-transparent to-transparent" aria-hidden="true" />
      <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Programme
      </p>
      <h1 id="program-title" className="mt-4 font-display text-[clamp(2.25rem,10vw,3rem)] font-extrabold uppercase leading-[0.95] text-ink">
        {title}
      </h1>
      {big && <p className="mt-2 font-display text-5xl font-extrabold uppercase leading-none text-gold">{big}</p>}
      {raceLine && <p className="mt-2 text-sm font-semibold uppercase tracking-[0.16em] text-gold">{raceLine}</p>}
      {!horizon && objective && <p className="mt-2 text-sm text-ink/80">Objectif : {objective}</p>}
      {progress && <p className="mt-4 text-sm text-ink/85">{progress}</p>}
      <p className="mt-5 border-t border-line pt-4 font-display text-xl font-extrabold uppercase leading-tight text-ink">
        Ton objectif reste.
        <br />
        <span className="text-gold">Ton plan s'adapte.</span>
      </p>
    </section>
  );
}
