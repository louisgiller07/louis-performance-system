import { Link } from "react-router-dom";
import { LOAD_PROFILE_LABELS, TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { formatDuration } from "../dailyPlan/durationLabels";
import { SESSION_TYPE_LABELS } from "../completedSession/completedSessionTypes";
import type { PlannedSessionRow } from "../planning/planningTypes";
import { daysBetween, type RaceHorizon } from "./todayContext";

// UX-04 — "Prochaine étape": the next planned session, tied to what it is
// all for (race or objective), closing on the brand promise. Editorial card,
// not a stat: only what is planned and what the athlete aims at.
const WEEKDAY = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long" });

function whenLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 1) return "Demain";
  const [y, m, d] = date.split("-").map(Number);
  const formatted = WEEKDAY.format(new Date(y!, m! - 1, d!));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** The session in large type, then its duration and load underneath. */
function sessionLabel(row: PlannedSessionRow): { title: string; detail: string | null } {
  if (!row.intervention) return { title: SESSION_TYPE_LABELS[row.session_type] ?? "Séance prévue", detail: null };
  const { kind, duration_min, load_profile } = row.intervention;
  const parts = [duration_min !== undefined ? formatDuration(duration_min) : null, load_profile ? LOAD_PROFILE_LABELS[load_profile] : null].filter(Boolean);
  return { title: TRAINING_KIND_LABELS[kind] ?? "Séance prévue", detail: parts.length > 0 ? parts.join(" · ") : null };
}

// A5-UI-FIX-01 (HPM 2026-10-23) — while Today is health-suspended (the same state as the guided entry and the
// after-session block: an open follow-up or concussion signal, or a Safety REST on screen), no future session is
// put forward as the next activity. The programme stays reachable; nothing here starts a session.
export const NEXT_STEP_SUSPENDED = {
  text: "Tant que ton suivi santé est ouvert, NALYNT ne propose pas de prochaine séance.",
  after: "Ensuite, NALYNT refait l'analyse de ta journée avant de te proposer une séance.",
} as const;

function contextLine(horizon: RaceHorizon | null, objective: string | null): string | null {
  if (horizon?.kind === "ongoing") return `Tu es en pleine course : ${horizon.race.eventName}.`;
  if (horizon?.kind === "countdown") return `Cap sur ${horizon.race.eventName}, dans ${horizon.days} jour${horizon.days > 1 ? "s" : ""}.`;
  if (horizon?.kind === "horizon") return `Cap sur ${horizon.race.eventName}, ton prochain objectif.`;
  if (objective) return `Cap sur ton objectif : ${objective}.`;
  return null;
}

export function NextStepCard({
  next,
  today,
  horizon,
  objective,
  suspended = false,
}: {
  next: PlannedSessionRow | null;
  today: string;
  horizon: RaceHorizon | null;
  objective: string | null;
  suspended?: boolean;
}) {
  const context = contextLine(horizon, objective);
  const session = next ? sessionLabel(next) : null;

  if (suspended) {
    return (
      <section aria-labelledby="next-step-title" className="ux-enter rounded-xl border border-line bg-card p-5" data-suspended="true">
        <h2 id="next-step-title" className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Prochaine étape
        </h2>
        <p className="mt-3 text-sm text-ink/80">{NEXT_STEP_SUSPENDED.text}</p>
        <p className="mt-2 text-sm text-ink/70">{NEXT_STEP_SUSPENDED.after}</p>
        <div className="mt-4 flex items-center justify-end border-t border-line pt-3">
          <Link to="/training-plan" className="ux-press shrink-0 text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
            Programme →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="next-step-title" className="ux-enter rounded-xl border border-line bg-card p-5">
      <h2 id="next-step-title" className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gold">
        <span className="h-px w-5 bg-gold" aria-hidden="true" />
        Prochaine étape
      </h2>
      {next && session ? (
        <>
          <p className="mt-3 text-sm text-muted">{whenLabel(next.planned_date, today)}</p>
          <p className="mt-0.5 font-display text-3xl font-extrabold uppercase leading-tight text-ink">{session.title}</p>
          {session.detail && <p className="mt-0.5 text-sm text-gold">{session.detail}</p>}
          {/* CONSISTENCY-01 — a session the rider set in /plan is not the programme's: same V06-02 fact as Programme. */}
          {next.source === "manual" && (
            <span className="mt-2 inline-flex items-center rounded-sm border border-line px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-ink/75">
              Modifiée par toi
            </span>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-ink/80">Aucune séance prévue dans les deux prochaines semaines.</p>
      )}
      {context && <p className="mt-3 text-sm leading-relaxed text-ink/80">{context}</p>}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Ton objectif reste. Ton plan s'adapte.</p>
        <Link to="/training-plan" className="ux-press shrink-0 text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
          Programme →
        </Link>
      </div>
    </section>
  );
}
