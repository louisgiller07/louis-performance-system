import { Link } from "react-router-dom";
import { formatLocalTime } from "../../lib/date";
import { formatIntervention, LOAD_PROFILE_LABELS, TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { formatDuration } from "../dailyPlan/durationLabels";
import { coachWhy, retainedSignals, SIGNAL_CHECKIN_FIELD } from "../dailyPlan/coachInsights";
import { checkinTiles } from "../dailyPlan/checkinTiles";
import { CHANGE_REASON_LABELS } from "../completedSession/completedSessionTypes";
import { performedLine, plannedLine } from "../afterSession/afterSessionPresentation";
import { isValidDailyPlan } from "../dailyPlan/dailyPlanValidation";
import type { TrainingIntervention } from "../dailyPlan/dailyPlanTypes";
import type { CompletedSessionRecord } from "../completedSession/completedSessionTypes";
import { dayOutcome, hasHealthSignal, type HistoryDay } from "./historyDays";
import type { DecisionHistoryRow } from "./historyTypes";

// UX-07 — one day of the journey, as a chapter:
// date and body state → the mission (what NALYNT asked) → what changed
// (planned → adapted) → why (UX-04 wording) → the athlete's check-in → what
// was recorded. Times appear only inside "Journée réévaluée". "full" for
// today and this week, "compact" (one line, tap for the detail) for older
// days. Never "tu n'as pas fait ta séance": an absent record is "non
// enregistrée" (forgotten, done elsewhere, not synced…).
const DAY_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long" });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const SHORT_FORMAT = new Intl.DateTimeFormat("fr-CH", { weekday: "short", day: "numeric" });

function localDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayTitle(date: string, today: string): string {
  return capitalize((date.slice(0, 4) === today.slice(0, 4) ? DAY_FORMAT : DAY_YEAR_FORMAT).format(localDate(date)));
}

function kindLabel(intervention: TrainingIntervention): string {
  return TRAINING_KIND_LABELS[intervention.kind] ?? "Séance";
}

function interventionMeta(intervention: TrainingIntervention): string {
  return [intervention.duration_min !== undefined ? formatDuration(intervention.duration_min) : null, intervention.load_profile ? LOAD_PROFILE_LABELS[intervention.load_profile] : null]
    .filter(Boolean)
    .join(" · ");
}

function interventionLine(intervention: TrainingIntervention): string {
  const base = formatIntervention(intervention);
  return intervention.duration_min !== undefined ? `${base} · ${formatDuration(intervention.duration_min)}` : base;
}

const RECORDED: Record<CompletedSessionRecord["completion_status"], string> = {
  done: "✓ Séance réalisée",
  partial: "◐ Séance partiellement réalisée",
  replaced: "↻ Séance remplacée",
  skipped: "Séance non réalisée",
};

/** UX-11R.9 — a day done through a completed guided session. */
const GUIDED_RECORDED = "✓ Séance guidée terminée";

/** What was recorded for the day; null when there is nothing to say. */
function recordedLine(day: HistoryDay, today: string): { text: string; recorded: boolean } | null {
  // UX-11R.9 — a guided session completed that day (and no legacy record saying more).
  if (day.guided) return { text: GUIDED_RECORDED, recorded: true };
  if (day.completed) {
    const duration = day.completed.completion_status !== "skipped" && day.completed.actual_duration_min !== null ? ` · ${formatDuration(day.completed.actual_duration_min)}` : "";
    return { text: `${RECORDED[day.completed.completion_status]}${duration}`, recorded: day.completed.completion_status !== "skipped" };
  }
  if (!day.dailyPlan || day.dailyPlan.planned_session_before === null) return null;
  // Validated wording: a day not yet passed is "à venir", never "non enregistrée".
  return { text: day.date < today ? "Séance non enregistrée" : "Séance à venir", recorded: false };
}

/** UX-08 — the recorded session, as facts: what was asked (the linked decision), what was done, effort, legs after, reason, a physical signal. */
function Realisation({ day }: { day: HistoryDay }) {
  const session = day.completed!;
  const linked = day.decisions.find((row) => row.id === session.decision_id);
  const planned = linked && isValidDailyPlan(linked.dailyPlan) ? linked.dailyPlan.final_session : null;
  const rows: [string, string][] = [];
  if (planned) rows.push(["Prévu", plannedLine(planned)]);
  if (session.completion_status !== "skipped") rows.push(["Réalisé", performedLine(session)]);
  if (session.rpe !== null) rows.push(["Effort", `${session.rpe}/10`]);
  if (session.post_leg_fatigue !== null) rows.push(["Jambes après", `${session.post_leg_fatigue}/10`]);
  if (session.change_reason) rows.push([session.completion_status === "skipped" ? "Ce qui a changé aujourd'hui" : "Ce qui a changé", CHANGE_REASON_LABELS[session.change_reason]]);
  if (session.new_pain) rows.push(["Signal physique", "signalé"]);
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Kicker>Réalisation</Kicker>
      <p className={`mt-1.5 text-sm ${session.completion_status === "skipped" ? "text-ink/80" : "text-gold"}`}>{RECORDED[session.completion_status]}</p>
      {rows.length > 0 && (
        <dl className="mt-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
              <dt className="text-xs uppercase tracking-[0.14em] text-muted">{label}</dt>
              <dd className="text-right text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Kicker({ children, tone = "gold" }: { children: string; tone?: "gold" | "red" }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${tone === "red" ? "text-red-400" : "text-gold"}`}>{children}</p>;
}

function Reevaluations({ decisions }: { decisions: DecisionHistoryRow[] }) {
  const count = decisions.length - 1;
  return (
    <details className="group mt-4 border-t border-line pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm text-ink/80 [&::-webkit-details-marker]:hidden">
        {`Journée réévaluée ${count === 1 ? "une fois" : `${count} fois`}`}
        <span className="text-gold transition-transform duration-300 group-open:rotate-90" aria-hidden="true">
          →
        </span>
      </summary>
      <ul className="mt-1 flex flex-col">
        {decisions.map((row, index) => {
          // Only a validated stored plan is read — a legacy row gets the time alone.
          const label = isValidDailyPlan(row.dailyPlan) ? formatIntervention(row.dailyPlan.final_session) : null;
          return (
            <li key={row.id}>
              <Link to={`/history/${row.id}`} className="ux-press flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 text-sm text-ink/80 last:border-b-0 hover:text-ink">
                <span>
                  <span className="block">{`${index === 0 ? "Première décision" : "Réévaluation"} · ${formatLocalTime(row.createdAt)}`}</span>
                  {label && <span className="block text-xs text-muted">{label}</span>}
                </span>
                <span className="text-gold" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function HistoryDayCard({ day, today }: { day: HistoryDay; today: string }) {
  const titleId = `day-${day.date}`;
  const health = hasHealthSignal(day);
  const plan = day.dailyPlan;
  const outcome = dayOutcome(day);
  const recorded = recordedLine(day, today);
  const tiles = day.checkin ? checkinTiles(day.checkin) : [];
  const retainedFields = new Set(plan ? retainedSignals(plan).map((entry) => SIGNAL_CHECKIN_FIELD[entry.signal]) : []);

  return (
    <article aria-labelledby={titleId} className={`ux-enter rounded-2xl border bg-card p-5 ${health ? "border-red-400/40" : "border-line"}`}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 id={titleId} className="font-display text-xl font-extrabold uppercase leading-tight text-ink">
          {dayTitle(day.date, today)}
        </h3>
        {plan && (
          <p className={`shrink-0 text-xs font-semibold uppercase tracking-[0.16em] ${health ? "text-red-400" : "text-gold"}`}>{health ? "Signal actif" : "Prêt"}</p>
        )}
      </header>
      {day.race && <p className="mt-1 text-sm text-gold">{`⚑ ${day.race.eventName}`}</p>}

      {!plan ? (
        <p className="mt-4 text-sm text-ink/80">Cette ancienne journée ne peut pas être affichée complètement.</p>
      ) : (
        <>
          <div className="mt-5">
            <Kicker tone={health ? "red" : "gold"}>{health ? "Signal santé" : "Mission du jour"}</Kicker>
            <p className="mt-2 font-display text-[clamp(2rem,9vw,2.5rem)] font-extrabold uppercase leading-[0.95] text-ink">{kindLabel(plan.final_session)}</p>
            {interventionMeta(plan.final_session) && <p className="mt-1 text-sm text-ink/75">{interventionMeta(plan.final_session)}</p>}
          </div>

          {outcome.kind === "adapted" && plan.planned_session_before && (
            <div className="mt-4 rounded-lg border border-gold/40 bg-gold/5 p-4">
              <p className="text-sm font-semibold text-ink">NALYNT a adapté ton plan</p>
              <p className="mt-2 text-sm text-ink/60 line-through decoration-muted/70">{interventionLine(plan.planned_session_before)}</p>
              <p className="my-1 text-gold" aria-hidden="true">
                ↓
              </p>
              <p className="text-sm font-medium text-ink">
                <span className="sr-only">Adapté : </span>
                {interventionLine(plan.final_session)}
              </p>
            </div>
          )}
          {outcome.kind === "kept" && <p className="mt-4 text-sm text-ink/80">Ta séance est restée conforme au plan.</p>}
          {outcome.kind === "unplanned" && <p className="mt-4 text-sm text-ink/80">Aucune séance prévue ce jour-là.</p>}

          <div className="mt-4 border-t border-line pt-4">
            <Kicker>Pourquoi ?</Kicker>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/90">{coachWhy(plan)}</p>
          </div>

          {tiles.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <Kicker>Ton état du jour</Kicker>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {tiles.map((tile) => (
                  <div key={tile.field}>
                    <dt className="text-xs uppercase tracking-[0.14em] text-muted">{tile.label}</dt>
                    <dd className={`mt-1 font-display text-2xl font-extrabold leading-none ${retainedFields.has(tile.field) ? "text-gold" : "text-ink"}`}>{tile.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}

      {day.completed && !day.guided ? (
        <Realisation day={day} />
      ) : (
        recorded && <p className="mt-4 border-t border-line pt-3 text-sm text-muted">{recorded.text}</p>
      )}

      {day.decisions.length > 1 && <Reevaluations decisions={day.decisions} />}

      <Link to={`/history/${day.main.id}`} className="ux-press mt-3 inline-flex min-h-11 items-center text-sm text-ink/80 underline-offset-4 hover:text-ink hover:underline">
        Voir le détail de la journée →
      </Link>
    </article>
  );
}

/** Older days: one line each, the full chapter one tap away. */
export function HistoryDayRow({ day, today }: { day: HistoryDay; today: string }) {
  const plan = day.dailyPlan;
  const outcome = dayOutcome(day);
  const recorded = recordedLine(day, today);
  const summary =
    outcome.kind === "adapted" && plan?.planned_session_before
      ? `${kindLabel(plan.planned_session_before)} → ${kindLabel(plan.final_session)}`
      : outcome.kind === "kept"
        ? "Conforme au plan"
        : outcome.kind === "unplanned"
          ? "Aucune séance prévue"
          : "Ancienne journée";
  return (
    <li>
      <Link to={`/history/${day.main.id}`} className="ux-press flex min-h-14 items-center gap-4 border-b border-line py-3 last:border-b-0">
        <span className="w-14 shrink-0 text-sm text-muted">{capitalize(SHORT_FORMAT.format(localDate(day.date)))}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-extrabold uppercase leading-tight text-ink">{plan ? kindLabel(plan.final_session) : "Journée"}</span>
          <span className="block text-xs text-ink/70">
            {summary}
            {hasHealthSignal(day) && <span className="text-red-400"> · Signal actif</span>}
            {recorded?.recorded && <span className="text-gold"> · {recorded.text}</span>}
          </span>
        </span>
        <span className="text-gold" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}
