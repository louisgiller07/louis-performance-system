import { TRAINING_KIND_LABELS, PRIOR_TECHNICAL_OUTCOME_COPY } from "./dailyPlanLabels";
import { athleteSafeTrainingObjective } from "./safetyPresentation";
import type { DailyPlan } from "./dailyPlanTypes";

// V0.3 UX PREMIUM REDESIGN — "Mission du jour", the new lead card (rendered
// before Head Coach Decision). Sources ONLY already-existing DailyPlan
// fields — final_session (kind/duration), dh_or_technical.focus/
// execution_task/spot_hint/prior_task_reference for a DH-family session,
// training.objective as the fallback for a non-DH session. No new field,
// no invented copy: for a DH-family session this is the same content
// previously shown inline by DailyPlanView's own "Today's Mission" card —
// hoisted here instead of duplicated (DailyPlanView suppresses its inline
// copy whenever a missionSlot is passed, see its own prop doc).
export function MissionCard({ dailyPlan }: { dailyPlan: DailyPlan }) {
  const isDh = dailyPlan.dh_or_technical.active;
  if (!isDh && !dailyPlan.training.active) return null;

  const kindLabel = TRAINING_KIND_LABELS[dailyPlan.final_session.kind] ?? dailyPlan.final_session.kind;
  const durationMin = dailyPlan.final_session.duration_min ?? dailyPlan.training.duration_min;

  const headline = isDh ? dailyPlan.dh_or_technical.focus : undefined;
  const body = isDh
    ? dailyPlan.dh_or_technical.execution_task
    : dailyPlan.training.objective
      ? athleteSafeTrainingObjective(dailyPlan)
      : undefined;
  const spotHint = isDh ? dailyPlan.dh_or_technical.spot_hint : undefined;
  const priorTask = isDh ? dailyPlan.dh_or_technical.prior_task_reference : undefined;

  if (!headline && !body && !spotHint && !priorTask) return null;

  return (
    <div className="rounded-xl border border-gold/20 bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">Mission du jour</p>
      <p className="mt-2 text-xl font-bold uppercase tracking-tight text-ink">{kindLabel}</p>
      {durationMin !== undefined && <p className="text-sm text-gold">{durationMin} min</p>}
      {(headline || body) && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Objectif</p>
          {headline && <p className="mt-1 font-medium text-ink">{headline}</p>}
          {body && <p className="mt-1 text-sm text-ink/70">{body}</p>}
        </div>
      )}
      {spotHint && <p className="mt-2 text-sm text-ink/70">{spotHint}</p>}
      {/*
       * V0.3_008B — historical fact from an earlier day, visually distinct
       * from today's "Objectif" above (its own label + italic task quote)
       * so it never reads as today's instruction.
       */}
      {priorTask && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="text-xs uppercase tracking-wide text-muted">Tâche précédente</p>
          <p className="mt-1 italic text-ink/70">« {priorTask.execution_task} »</p>
          <p className="text-ink/70">{PRIOR_TECHNICAL_OUTCOME_COPY[priorTask.technical_outcome]}</p>
        </div>
      )}
    </div>
  );
}
