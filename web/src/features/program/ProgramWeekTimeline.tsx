import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { WeekDaysPicker } from "../../components/WeekDaysPicker";
import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { RaceOverlayEvent } from "../planning/raceOverlayRepo";
import { weekDates } from "../today/todayContext";
import { calendarMondays, initialMonday, planWeekAt, programWeekDays } from "./programPresentation";

// UX-06 — the plan as calendar weeks (Monday → Sunday, like Today), with
// the same day strip and symbols; ‹ › moves across the plan's weeks. The
// phase shown is the stored week type of the plan week covering those days.
const WEEK_OF = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" });

function weekOfLabel(monday: string): string {
  const [y, m, d] = monday.split("-").map(Number);
  return `Semaine du ${WEEK_OF.format(new Date(y!, m! - 1, d!))}`;
}

export function ProgramWeekTimeline({
  review,
  today,
  completed,
  races,
}: {
  review: TrainingPlanReview;
  today: string;
  completed: CompletedSessionRecord[];
  races: RaceOverlayEvent[];
}) {
  const mondays = useMemo(() => calendarMondays(review), [review]);
  const [monday, setMonday] = useState(() => initialMonday(mondays, today));
  const index = mondays.indexOf(monday);
  const days = programWeekDays(monday, today, review, completed, races);
  const phase = weekDates(monday)
    .map((date) => planWeekAt(review, date)?.phase)
    .find(Boolean);
  const currentMonday = weekDates(today)[0]!;
  const todayInPlan = review.version.horizonStartDate <= today && today <= review.version.horizonEndDate;
  const firstPlanned = days.findIndex((day) => day.planned);

  return (
    <section aria-labelledby="program-week-title" className="ux-enter rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Semaine précédente"
          disabled={index <= 0}
          onClick={() => setMonday(mondays[index - 1]!)}
          className="ux-press flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink/80 hover:border-gold/60 disabled:opacity-30"
        >
          ‹
        </button>
        <div className="text-center">
          <h2 id="program-week-title" className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
            {monday === currentMonday ? "Cette semaine" : weekOfLabel(monday)}
          </h2>
          {phase && <p className="mt-1 font-display text-xl font-extrabold uppercase leading-none text-ink">{phase}</p>}
        </div>
        <button
          type="button"
          aria-label="Semaine suivante"
          disabled={index >= mondays.length - 1}
          onClick={() => setMonday(mondays[index + 1]!)}
          className="ux-press flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink/80 hover:border-gold/60 disabled:opacity-30"
        >
          ›
        </button>
      </div>

      <div key={monday} className="ux-enter">
        <WeekDaysPicker days={days} initialIndex={days.some((day) => day.isToday) ? undefined : Math.max(0, firstPlanned)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-[0.68rem] text-muted">✓ réalisée · ● aujourd'hui · ○ prévue · ⚑ course</p>
        {monday !== currentMonday && todayInPlan && (
          <Link to="/today" className="ux-press shrink-0 text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
            Voir la séance du jour →
          </Link>
        )}
      </div>
    </section>
  );
}
