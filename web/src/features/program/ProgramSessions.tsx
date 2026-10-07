import type { TrainingPlanReview } from "../trainingPlanReview/trainingPlanReviewTypes";
import type { GuidedCompletion } from "../completion/dayCompletion";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import type { DailyPlan } from "../dailyPlan/dailyPlanTypes";
import { adaptationFrom, completionOn, splitByToday } from "./programPresentation";
import { ProgramSessionCard } from "./ProgramSessionCard";
import type { EffectiveDay } from "../effectiveSession/effectiveDay";

// UX-06 — "Aujourd'hui" (dominant), "À venir" (compact, a few visible, the
// rest one tap away) and "Terminé" (folded). Future sessions are always
// "Prévue": NALYNT adapts a session on the day, from the check-in.
const UPCOMING_VISIBLE = 4;

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
      <span className="h-px w-5 bg-gold" aria-hidden="true" />
      {children}
    </h2>
  );
}

export function ProgramSessions({
  review,
  today,
  completed,
  guided = [],
  decisionsByDate,
  modifiedDates,
  effectiveByDate = new Map(),
}: {
  review: TrainingPlanReview;
  today: string;
  completed: CompletedSessionRecord[];
  /** UX-11R.9 — completed guided sessions (dayCompletion.ts). */
  guided?: readonly GuidedCompletion[];
  decisionsByDate: Map<string, DailyPlan>;
  modifiedDates: readonly string[];
  /** A07 — the effective session of today / past plan days. */
  effectiveByDate?: ReadonlyMap<string, EffectiveDay>;
}) {
  const { today: todaySession, upcoming, past } = splitByToday(review, today);
  const visible = upcoming.slice(0, UPCOMING_VISIBLE);
  const more = upcoming.slice(UPCOMING_VISIBLE);
  const card = (session: (typeof upcoming)[number], variant: "upcoming" | "past") => (
    <ProgramSessionCard
      key={session.id}
      session={session}
      today={today}
      variant={variant}
      completion={variant === "past" ? completionOn(session.date, completed, guided) : null}
      adaptation={variant === "past" ? adaptationFrom(decisionsByDate.get(session.date)) : null}
      modifiedByAthlete={modifiedDates.includes(session.date)}
      effective={variant === "past" ? (effectiveByDate.get(session.date) ?? null) : null}
    />
  );

  return (
    <>
      {/* No session today: no card — the week strip above already says "Libre". */}
      {todaySession && (
        <ProgramSessionCard
          session={todaySession}
          today={today}
          variant="today"
          completion={completionOn(today, completed, guided)}
          adaptation={adaptationFrom(decisionsByDate.get(today))}
          modifiedByAthlete={modifiedDates.includes(today)}
          effective={effectiveByDate.get(today) ?? null}
        />
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
          <SectionTitle id="upcoming-title">À venir</SectionTitle>
          <p className="text-sm text-muted">NALYNT ajuste chaque séance le jour même selon ton état.</p>
          <ul className="flex flex-col gap-2">{visible.map((session) => card(session, "upcoming"))}</ul>
          {more.length > 0 && (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg border border-line px-4 text-sm text-ink/80 [&::-webkit-details-marker]:hidden">
                {more.length === 1 ? "Voir la séance suivante" : `Voir les ${more.length} séances suivantes`}
                <span className="text-gold transition-transform duration-300 group-open:rotate-90" aria-hidden="true">
                  →
                </span>
              </summary>
              <ul className="mt-2 flex flex-col gap-2">{more.map((session) => card(session, "upcoming"))}</ul>
            </details>
          )}
        </section>
      )}

      {past.length > 0 && (
        <details className="group" aria-labelledby="past-title">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
            <SectionTitle id="past-title">{`Terminé · ${past.length}`}</SectionTitle>
            <span className="text-gold transition-transform duration-300 group-open:rotate-90" aria-hidden="true">
              →
            </span>
          </summary>
          <ul className="mt-3 flex flex-col gap-2">{past.map((session) => card(session, "past"))}</ul>
        </details>
      )}
    </>
  );
}
