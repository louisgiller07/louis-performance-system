import { DECISION_LABELS, formatConfidence, LOAD_PROFILE_LABELS, PRIOR_TECHNICAL_OUTCOME_COPY, TRAINING_KIND_LABELS, TRAINING_MODE_LABELS } from "./dailyPlanLabels";
import { athleteSafeReasoning, athleteSafeTrainingObjective } from "./safetyPresentation";
import { formatDuration } from "./durationLabels";
import type { DailyPlan, TrainingIntervention } from "./dailyPlanTypes";

// UX-03 — "Ta mission du jour", the dominant hero of Today. It merges what
// used to be two stacked cards (MissionCard + DecisionHero) into one, and
// adds the planned → adapted comparison. Every value comes from fields the
// engine already produced — final_session, planned_session_before,
// decision, confidence, reasoning, dh_or_technical / training — nothing is
// computed or re-decided here:
// - "adapted" is simply decision !== KEEP with a planned session to compare
//   against (the Head Coach's own verdict), never a frontend rule;
// - reasoning and objectives go through the same safetyPresentation
//   sanitizers as before (no raw rule text / health-flag slug can leak);
// - REST stays on the red safety accent, never gold.
// History (HistoryDetail) keeps its own DecisionHero-based layout.

const DECISION_TONE: Record<string, { border: string; chip: string; glow: string }> = {
  KEEP: { border: "border-gold/45", chip: "border-gold/60 text-gold", glow: "from-gold/12" },
  MODIFY: { border: "border-gold/45", chip: "border-amber-300/60 text-amber-200", glow: "from-gold/12" },
  REPLACE: { border: "border-gold/45", chip: "border-gold-light/70 text-gold-light", glow: "from-gold/12" },
  REST: { border: "border-red-500/50", chip: "border-red-500/60 text-red-300", glow: "from-red-500/10" },
};

function kindLabel(intervention: TrainingIntervention): string {
  return TRAINING_KIND_LABELS[intervention.kind] ?? "Séance";
}

/** One side of the planned → adapted comparison: the most telling value first. */
function describe(intervention: TrainingIntervention, showKind: boolean): { primary: string; secondary?: string } {
  const duration = intervention.duration_min !== undefined ? formatDuration(intervention.duration_min) : undefined;
  const load = intervention.load_profile ? LOAD_PROFILE_LABELS[intervention.load_profile] : undefined;
  if (showKind) return { primary: kindLabel(intervention), secondary: [duration, load].filter(Boolean).join(" · ") || undefined };
  return { primary: duration ?? load ?? kindLabel(intervention), secondary: duration && load ? load : undefined };
}

function AdaptationCompare({ before, after }: { before: TrainingIntervention; after: TrainingIntervention }) {
  const kindChanged = before.kind !== after.kind;
  const planned = describe(before, kindChanged);
  const adapted = describe(after, kindChanged);

  return (
    <div className="mission-compare mt-6 grid grid-cols-[1fr_auto_1fr] items-stretch overflow-hidden rounded-lg border border-line bg-bg/40">
      <div className="p-4">
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted">
          <span aria-hidden="true">✕</span> Prévu
        </p>
        <p className="relative mt-2 inline-block font-display text-3xl font-extrabold uppercase leading-none text-muted">
          {planned.primary}
          <span className="mission-strike absolute inset-x-[-0.1em] top-1/2 h-[3px] origin-left bg-muted" aria-hidden="true" />
        </p>
        {planned.secondary && <p className="mt-1.5 text-xs text-muted">{planned.secondary}</p>}
      </div>
      <div className="flex items-center text-gold" aria-hidden="true">
        →
      </div>
      <div className="mission-adapted p-4">
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-gold">
          <span aria-hidden="true">✓</span> Adapté
        </p>
        <p className="mt-2 font-display text-3xl font-extrabold uppercase leading-none text-gold">{adapted.primary}</p>
        {adapted.secondary && <p className="mt-1.5 text-xs text-ink/70">{adapted.secondary}</p>}
      </div>
      <p className="sr-only">
        Prévu : {planned.primary}
        {planned.secondary ? ` (${planned.secondary})` : ""}. Adapté : {adapted.primary}
        {adapted.secondary ? ` (${adapted.secondary})` : ""}.
      </p>
    </div>
  );
}

export function MissionHero({ dailyPlan }: { dailyPlan: DailyPlan }) {
  const final = dailyPlan.final_session;
  const before = dailyPlan.planned_session_before;
  const tone = DECISION_TONE[dailyPlan.decision] ?? DECISION_TONE.KEEP!;
  const decisionLabel = DECISION_LABELS[dailyPlan.decision] ?? null;
  const confidenceLabel = formatConfidence(dailyPlan.confidence);
  const adapted = dailyPlan.decision !== "KEEP" && before !== null;

  const isDh = dailyPlan.dh_or_technical.active;
  const durationMin = final.duration_min ?? dailyPlan.training.duration_min;
  const headline = isDh ? dailyPlan.dh_or_technical.focus : undefined;
  const rawBody = isDh
    ? dailyPlan.dh_or_technical.execution_task
    : dailyPlan.training.active && dailyPlan.training.objective
      ? athleteSafeTrainingObjective(dailyPlan)
      : undefined;
  const spotHint = isDh ? dailyPlan.dh_or_technical.spot_hint : undefined;
  const priorTask = isDh ? dailyPlan.dh_or_technical.prior_task_reference : undefined;
  const reasoning = athleteSafeReasoning(dailyPlan);
  // No repetition: an objective sentence the coach's reasoning already says verbatim is not shown twice.
  const body = rawBody && !reasoning.includes(rawBody.trim()) ? rawBody : undefined;
  const loadLabel = final.load_profile ? LOAD_PROFILE_LABELS[final.load_profile] : undefined;
  const sessionLine = [durationMin !== undefined ? formatDuration(durationMin) : undefined, loadLabel].filter(Boolean).join(" · ");
  // The training phase (e.g. "Semaine de course") as a French label, never the raw enum;
  // "Phase non configurée" (UNSPECIFIED) tells the rider nothing, so it is not shown.
  const modeLabel = dailyPlan.active_mode !== "UNSPECIFIED" ? (TRAINING_MODE_LABELS[dailyPlan.active_mode] ?? null) : null;

  return (
    <section
      aria-labelledby="mission-title"
      className={`mission-hero ux-grain relative overflow-hidden rounded-2xl border bg-card p-6 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.9)] ${tone.border}`}
    >
      <div className={`pointer-events-none absolute inset-0 -z-10 bg-linear-to-br ${tone.glow} via-transparent to-transparent`} aria-hidden="true" />
      <div className="ux-enter flex items-start justify-between gap-3">
        <p className="flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-5 bg-gold" aria-hidden="true" />
          Ta mission du jour
        </p>
        {modeLabel && <p className="shrink-0 text-right text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted">{modeLabel}</p>}
      </div>
      <h2 id="mission-title" className="ux-enter mt-4 font-display text-[clamp(2.75rem,13vw,3.75rem)] font-extrabold uppercase leading-[0.9] text-ink" style={{ ["--d" as string]: "80ms" }}>
        {kindLabel(final)}
      </h2>

      {adapted && before ? (
        <div className="ux-enter" style={{ ["--d" as string]: "160ms" }}>
          <AdaptationCompare before={before} after={final} />
        </div>
      ) : (
        sessionLine && (
          <p className="ux-enter mt-2 font-display text-2xl font-semibold uppercase tracking-wide text-gold" style={{ ["--d" as string]: "160ms" }}>
            {sessionLine}
          </p>
        )
      )}

      <div className="ux-enter mt-5 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ ["--d" as string]: "240ms" }}>
        {decisionLabel && (
          <span className={`inline-flex items-center rounded-sm border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] ${tone.chip}`}>
            {decisionLabel}
          </span>
        )}
        {confidenceLabel && <span className="text-sm text-muted">Confiance {confidenceLabel.toLowerCase()}</span>}
      </div>

      {(headline || body || spotHint) && (
        <div className="ux-enter mt-5 border-t border-line pt-5" style={{ ["--d" as string]: "320ms" }}>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted">Objectif</p>
          {headline && <p className="mt-1.5 text-lg font-medium leading-snug text-ink">{headline}</p>}
          {body && <p className="mt-1.5 text-sm leading-relaxed text-ink/75">{body}</p>}
          {spotHint && <p className="mt-1.5 text-sm leading-relaxed text-ink/75">{spotHint}</p>}
        </div>
      )}

      <p className="ux-enter mt-5 border-l border-gold/60 pl-4 text-sm leading-relaxed text-ink/85" style={{ ["--d" as string]: "400ms" }}>
        {reasoning}
      </p>

      {/*
       * V0.3_008B — historical fact from an earlier day, kept visually
       * distinct from today's objective (own label + italic quote) so it
       * never reads as today's instruction.
       */}
      {priorTask && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[0.68rem] uppercase tracking-[0.2em] text-muted">Tâche précédente</p>
          <p className="mt-1 italic text-ink/70">« {priorTask.execution_task} »</p>
          <p className="text-sm text-ink/70">{PRIOR_TECHNICAL_OUTCOME_COPY[priorTask.technical_outcome]}</p>
        </div>
      )}
    </section>
  );
}
