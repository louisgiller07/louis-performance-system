import { Link } from "react-router-dom";
import type { TrainingPlanReviewSession } from "../trainingPlanReview/trainingPlanReviewTypes";
import { TrainingPlanSessionCard } from "../trainingPlanReview/components/TrainingPlanSessionCard";
import { COMPLETION_STATUS_LABELS, type CompletionStatus } from "../completedSession/completedSessionTypes";
import { formatDuration } from "../dailyPlan/durationLabels";
import { LOAD_PROFILE_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { LoadProfile } from "../dailyPlan/dailyPlanTypes";
import { daysBetween } from "../today/todayContext";
import { sessionFocus, sessionTitle, type Adaptation } from "./programPresentation";
import { ProgramAdaptationCard } from "./ProgramAdaptationCard";

// UX-06 — one plan session as a premium card, in three weights:
// - "today": the dominant card (focus, adaptation if NALYNT adapted today,
//   the full prescription one tap away, and the way to today's mission);
// - "upcoming": compact — a future session is always "Prévue";
// - "past": compact — what actually happened (recorded completion, or "Non
//   enregistrée"), and the adaptation if NALYNT adapted that day.
// "Focus" is the first exercise / drill of the stored prescription, hidden
// when there is none. "Modifiée par toi" is the existing V06-02 fact.
const DAY_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric", month: "short" });

function dayLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff === -1) return "Hier";
  const [y, m, d] = date.split("-").map(Number);
  const formatted = DAY_FORMAT.format(new Date(y!, m! - 1, d!));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function metaLine(session: TrainingPlanReviewSession): string {
  const load = session.loadProfile && Object.prototype.hasOwnProperty.call(LOAD_PROFILE_LABELS, session.loadProfile) ? LOAD_PROFILE_LABELS[session.loadProfile as LoadProfile] : null;
  return [session.durationMin !== null ? formatDuration(session.durationMin) : null, load].filter(Boolean).join(" · ");
}

function Chip({ children, tone = "muted" }: { children: string; tone?: "gold" | "muted" }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] ${tone === "gold" ? "border-gold/60 text-gold" : "border-line text-ink/75"}`}>
      {children}
    </span>
  );
}

interface ProgramSessionCardProps {
  session: TrainingPlanReviewSession;
  today: string;
  variant: "today" | "upcoming" | "past";
  completion?: CompletionStatus | null;
  adaptation?: Adaptation | null;
  modifiedByAthlete?: boolean;
}

export function ProgramSessionCard({ session, today, variant, completion = null, adaptation = null, modifiedByAthlete = false }: ProgramSessionCardProps) {
  const focus = sessionFocus(session);
  const meta = metaLine(session);

  if (variant === "today") {
    return (
      <section aria-labelledby={`session-${session.id}`} className="ux-enter ux-grain relative overflow-hidden rounded-2xl border border-gold/45 bg-card p-6">
        <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Aujourd'hui
        </p>
        <h2 id={`session-${session.id}`} className="mt-3 font-display text-[clamp(2.25rem,10vw,3rem)] font-extrabold uppercase leading-[0.95] text-ink">
          {sessionTitle(session)}
        </h2>
        {meta && <p className="mt-2 font-display text-xl font-semibold uppercase tracking-wide text-gold">{meta}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {completion && completion !== "skipped" && <Chip tone="gold">{`✓ ${COMPLETION_STATUS_LABELS[completion]}`}</Chip>}
          {modifiedByAthlete && <Chip>Modifiée par toi</Chip>}
        </div>
        {focus && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Focus</p>
            <p className="mt-1 text-lg font-medium leading-snug text-ink">{focus}</p>
          </div>
        )}
        {adaptation && <ProgramAdaptationCard adaptation={adaptation} />}
        <div className="mt-5 flex flex-col gap-2">
          <details className="group rounded-lg border border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm text-ink/85 [&::-webkit-details-marker]:hidden">
              Voir la séance
              <span className="text-gold transition-transform duration-300 group-open:rotate-90" aria-hidden="true">
                →
              </span>
            </summary>
            <div className="border-t border-line p-2">
              <TrainingPlanSessionCard session={session} />
            </div>
          </details>
          <Link to="/today" className="ux-press inline-flex min-h-11 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
            Ta mission du jour →
          </Link>
        </div>
      </section>
    );
  }

  const status = variant === "upcoming" ? "Prévue" : completion ? COMPLETION_STATUS_LABELS[completion] : "Non enregistrée";
  return (
    <li className="ux-enter rounded-xl border border-line bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{dayLabel(session.date, today)}</p>
        <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${variant === "past" && completion && completion !== "skipped" ? "text-gold" : "text-muted"}`}>{status}</p>
      </div>
      <p className="mt-1 font-display text-2xl font-extrabold uppercase leading-tight text-ink">{sessionTitle(session)}</p>
      {meta && <p className="text-sm text-ink/75">{meta}</p>}
      {focus && (
        <p className="mt-1.5 text-sm text-ink/80">
          <span className="text-muted">Focus · </span>
          {focus}
        </p>
      )}
      {modifiedByAthlete && (
        <div className="mt-2">
          <Chip>Modifiée par toi</Chip>
        </div>
      )}
      {variant === "past" && adaptation && <ProgramAdaptationCard adaptation={adaptation} compact />}
    </li>
  );
}
