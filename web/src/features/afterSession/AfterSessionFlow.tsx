import { useState, type FormEvent, type ReactNode } from "react";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { formatIntervention, LOAD_PROFILE_LABELS, TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import type { LoadProfile } from "../dailyPlan/dailyPlanTypes";
import {
  CHANGE_REASON_LABELS,
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  TECHNICAL_OUTCOMES,
  TECHNICAL_OUTCOME_LABELS,
  type CompletionStatus,
} from "../completedSession/completedSessionTypes";
import { PERFORMED_KIND_GROUPS } from "../completedSession/performedKindGroups";
import { isUpliftServedDhDurationKind } from "../completedSession/dhFamilyKind";
import { effectiveLinkableDecision, type CompletedSessionFlow } from "./useCompletedSessionFlow";
import { afterSessionSteps, isStepAnswered, type AfterSessionStepId } from "./afterSessionSteps";
import { ScaleChoice } from "./ScaleChoice";
import { ACTIVITY, BODY, BUTTONS, EFFORT, PLAN, REASON, SIGNAL, STATUS_CHOICES, effortLabel, flowTitle, planOptionLabel, reasonsFor, stepCopy } from "./afterSessionPresentation";

// UX-08 — "Comment s'est passée ta séance ?" in short steps, one question at
// a time (same rhythm as the guided check-in). Single-answer steps move on by
// themselves; the answers are the flow's form, validated and sent unchanged.
const LOAD_CHOICES: readonly LoadProfile[] = ["HEAVY", "MODERATE", "LIGHT"];
const AUTO_ADVANCE_MS = 220;

function Choice({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={`ux-press min-h-12 rounded-lg border px-4 py-3 text-left text-sm font-medium ${
        pressed ? "border-gold bg-gold/12 text-ink" : "border-line text-ink/80 hover:border-gold/50"
      }`}
    >
      {children}
    </button>
  );
}

function Note({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-ink/80">
      {label}
      <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} rows={2} className="rounded border border-line bg-transparent px-3 py-3 text-base text-ink" />
      {error && value.trim().length > 0 && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}

export function AfterSessionFlow({ flow }: { flow: CompletedSessionFlow; isNew?: boolean }) {
  // A11 — the position lives with the draft (closing the sheet or a failed send never loses it).
  const { index, statusChosen } = flow.progress;
  const setIndex = (next: number | ((current: number) => number)) =>
    flow.setProgress((p) => ({ ...p, index: typeof next === "function" ? next(p.index) : next }));
  const setStatusChosen = (chosen: boolean) => flow.setProgress((p) => ({ ...p, statusChosen: chosen }));
  const [picking, setPicking] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const form = flow.form!;
  const steps = afterSessionSteps(flow);
  const step: AfterSessionStepId = steps[Math.min(index, steps.length - 1)]!;
  const isLast = index >= steps.length - 1;
  const answered = step === "status" ? statusChosen : isStepAnswered(step, flow);
  const copy = stepCopy(step, form.completion_status);
  const plannedMinutes = form.completion_status === "done" ? flow.linkedFinalSession?.duration_min : undefined;

  // Moves on from the step that was answered only — a second quick tap never skips a step.
  function advanceSoon() {
    const from = index;
    window.setTimeout(() => setIndex((current) => (current === from ? from + 1 : current)), AUTO_ADVANCE_MS);
  }

  function chooseStatus(status: CompletionStatus) {
    flow.setStatus(status);
    setStatusChosen(true);
    setPicking(false);
    setCustomDuration(false);
    advanceSoon();
  }

  function next(event?: FormEvent) {
    event?.preventDefault();
    if (!answered) return;
    if (isLast) void flow.submit();
    else setIndex(index + 1);
  }

  const activityOtherwiseAnswered =
    !flow.fieldErrors.performed_kind && !flow.fieldErrors.performed_load && (!flow.showTechnicalOutcome || form.technical_outcome !== "");

  const sections: Record<AfterSessionStepId, ReactNode> = {
    status: (
      <div role="group" aria-label={copy.question} className="flex flex-col gap-2">
        {STATUS_CHOICES.map((choice) => (
          <Choice key={choice.status} pressed={statusChosen && form.completion_status === choice.status} onClick={() => chooseStatus(choice.status)}>
            <span className="flex items-center gap-3 text-base">
              <span className="w-5 text-center text-gold" aria-hidden="true">
                {choice.icon}
              </span>
              {choice.label}
            </span>
          </Choice>
        ))}
      </div>
    ),
    plan: (
      <div role="group" aria-label={copy.question} className="flex flex-col gap-2">
        <p className="text-sm text-muted" data-testid="after-session-plan-why">
          {PLAN.ambiguous}
        </p>
        {flow.linkableDecisions.map((decision) => (
          <Choice key={decision.decisionId} pressed={flow.decisionLinkResolved && form.decision_id === decision.decisionId} onClick={() => flow.setDecision(decision.decisionId)}>
            {planOptionLabel(decision)}
          </Choice>
        ))}
        <Choice pressed={flow.decisionLinkResolved && form.decision_id === null} onClick={() => flow.setDecision(null)}>
          {PLAN.none}
        </Choice>
      </div>
    ),
    activity: (
      <div className="flex flex-col gap-5">
        {flow.decisionResolution === "error" && <p className="text-xs text-muted">{PLAN.lookupFailed}</p>}
        {flow.linkableDecisions.length >= 1 && !flow.ambiguousDecisions && form.completion_status !== "skipped" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 text-sm">
            <span className="text-ink/80">
              {form.decision_id ? (
                <>
                  <span className="text-muted">{`${PLAN.linked} · `}</span>
                  {formatIntervention(flow.linkedFinalSession ?? flow.linkableDecisions[0]!.finalSession)}
                </>
              ) : (
                PLAN.free
              )}
            </span>
            <button
              type="button"
              onClick={() => flow.setDecision(form.decision_id ? null : (effectiveLinkableDecision(flow.linkableDecisions).decision?.decisionId ?? null))}
              className="ux-press min-h-11 shrink-0 text-gold underline-offset-4 hover:underline"
            >
              {form.decision_id ? PLAN.unlink : PLAN.relink}
            </button>
          </div>
        )}

        {form.completion_status === "skipped" ? (
          flow.skippedTypeLocked ? (
            <p className="font-display text-3xl font-extrabold uppercase leading-none text-ink">{form.skipped_session_type ? SESSION_TYPE_LABELS[form.skipped_session_type] : ""}</p>
          ) : (
            <div role="group" aria-label={ACTIVITY.skippedType} className="grid grid-cols-2 gap-2">
              {SESSION_TYPES.map((type) => (
                <Choice key={type} pressed={form.skipped_session_type === type} onClick={() => flow.updateField("skipped_session_type", type)}>
                  {SESSION_TYPE_LABELS[type]}
                </Choice>
              ))}
            </div>
          )
        ) : form.performed_kind !== "" && !picking ? (
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-3xl font-extrabold uppercase leading-none text-ink">{TRAINING_KIND_LABELS[form.performed_kind]}</p>
            <button type="button" onClick={() => setPicking(true)} className="ux-press min-h-11 shrink-0 text-sm text-gold underline-offset-4 hover:underline">
              {ACTIVITY.change}
            </button>
          </div>
        ) : (
          <div role="group" aria-label={ACTIVITY.pick} className="flex flex-col gap-3">
            {PERFORMED_KIND_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs uppercase tracking-[0.16em] text-muted">{group.label}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {group.kinds.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={form.performed_kind === kind}
                      onClick={() => {
                        flow.setPerformedKind(kind);
                        setPicking(false);
                      }}
                      className={`ux-press min-h-11 rounded-full border px-3.5 text-sm ${form.performed_kind === kind ? "border-gold bg-gold text-bg" : "border-line text-ink/80 hover:border-gold/50"}`}
                    >
                      {TRAINING_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {form.completion_status !== "skipped" && flow.isVariablePerformedKind && !picking && (
          <div role="group" aria-label={ACTIVITY.intensity} className="flex gap-2">
            {LOAD_CHOICES.map((load) => (
              <button
                key={load}
                type="button"
                aria-pressed={form.performed_load === load}
                onClick={() => flow.updateField("performed_load", load)}
                className={`ux-press min-h-11 flex-1 rounded border px-2 text-xs font-medium ${form.performed_load === load ? "border-gold bg-gold text-bg" : "border-line text-ink/70"}`}
              >
                {LOAD_PROFILE_LABELS[load]}
              </button>
            ))}
          </div>
        )}
        {flow.fieldErrors.completion_status && (
          <p role="alert" className="text-xs text-red-400">
            {flow.fieldErrors.completion_status}
          </p>
        )}

        {flow.showTechnicalOutcome && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink/80">{ACTIVITY.taskQuestion}</p>
            <p className="text-sm italic text-ink/70">{`« ${flow.linkedExecutionTask} »`}</p>
            <div role="group" aria-label={ACTIVITY.taskQuestion} className="flex gap-2">
              {TECHNICAL_OUTCOMES.map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  aria-pressed={form.technical_outcome === outcome}
                  onClick={() => flow.updateField("technical_outcome", outcome)}
                  className={`ux-press min-h-11 flex-1 rounded border px-2 text-sm font-medium ${form.technical_outcome === outcome ? "border-gold bg-gold text-bg" : "border-line text-ink/70"}`}
                >
                  {TECHNICAL_OUTCOME_LABELS[outcome]}
                </button>
              ))}
            </div>
          </div>
        )}

        {!flow.hideDurationRpe && !picking && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-sm font-medium text-ink">{ACTIVITY.duration}</p>
            <p className="text-xs text-muted">{isUpliftServedDhDurationKind(form.performed_kind) ? ACTIVITY.dhDurationHelper : ACTIVITY.durationHelper}</p>
            {plannedMinutes !== undefined && !customDuration ? (
              <>
                <PrimaryButton
                  aria-pressed={form.actual_duration_min === plannedMinutes}
                  onClick={() => {
                    flow.updateField("actual_duration_min", plannedMinutes);
                    if (activityOtherwiseAnswered) advanceSoon();
                  }}
                  className="w-full"
                >
                  {ACTIVITY.asPlanned(plannedMinutes)}
                </PrimaryButton>
                <button type="button" onClick={() => setCustomDuration(true)} className="ux-press min-h-11 self-start text-sm text-ink/80 underline-offset-4 hover:underline">
                  {ACTIVITY.otherDuration}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={ACTIVITY.less}
                  onClick={() => flow.updateField("actual_duration_min", Math.max(5, (form.actual_duration_min === "" ? (plannedMinutes ?? 60) : form.actual_duration_min) - 5))}
                  className="ux-press h-12 w-12 shrink-0 rounded-full border border-line text-xl text-ink/80"
                >
                  −
                </button>
                <label className="flex flex-1 items-baseline justify-center gap-2">
                  <span className="sr-only">{`${ACTIVITY.duration} (${ACTIVITY.minutes})`}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={form.actual_duration_min}
                    onChange={(event) => flow.updateField("actual_duration_min", event.target.value === "" ? "" : Number(event.target.value))}
                    className="w-24 rounded border border-line bg-transparent px-3 py-2 text-center font-display text-3xl font-extrabold text-ink"
                  />
                  <span className="text-sm text-muted">{ACTIVITY.minutes}</span>
                </label>
                <button
                  type="button"
                  aria-label={ACTIVITY.more}
                  onClick={() => flow.updateField("actual_duration_min", (form.actual_duration_min === "" ? (plannedMinutes ?? 60) : form.actual_duration_min) + 5)}
                  className="ux-press h-12 w-12 shrink-0 rounded-full border border-line text-xl text-ink/80"
                >
                  +
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    ),
    reason: (
      <div className="flex flex-col gap-4">
        <div role="group" aria-label={copy.question} className="flex flex-col gap-2">
          {reasonsFor(form.completion_status, form.decision_id !== null).map((reason) => (
            <Choice key={reason} pressed={form.change_reason === reason} onClick={() => flow.setChangeReason(reason)}>
              {CHANGE_REASON_LABELS[reason]}
            </Choice>
          ))}
        </div>
        {flow.showBodyInReason && (
          // A11 — the one case M1 reads post-session fatigue (D-1 recovery continuity): asked here, optional.
          <div className="flex flex-col gap-5 border-t border-line pt-4" data-testid="after-session-body">
            <p className="text-sm text-ink/80">{BODY.question}</p>
            <ScaleChoice
              label={BODY.legs.label}
              value={form.post_leg_fatigue}
              anchors={[
                { value: 0, label: BODY.legs.low },
                { value: 10, label: BODY.legs.high },
              ]}
              onChange={(value) => flow.updateField("post_leg_fatigue", value)}
            />
            <ScaleChoice
              label={BODY.forearms.label}
              value={form.post_grip_fatigue}
              anchors={[
                { value: 0, label: BODY.forearms.low },
                { value: 10, label: BODY.forearms.high },
              ]}
              onChange={(value) => flow.updateField("post_grip_fatigue", value)}
            />
          </div>
        )}
        {flow.showPainInReason && (
          // A11 — a session skipped for pain: is it a NEW pain? The check-in then carries the safety path.
          <div className="flex flex-col gap-3 border-t border-line pt-4" data-testid="after-session-pain">
            <p className="text-sm text-ink/80">{REASON.newPainQuestion}</p>
            <div role="group" aria-label={REASON.newPainQuestion} className="grid grid-cols-2 gap-2">
              <Choice pressed={form.new_pain === false} onClick={() => flow.updateField("new_pain", false)}>
                <span className="block text-center text-base">{SIGNAL.no}</span>
              </Choice>
              <Choice pressed={form.new_pain === true} onClick={() => flow.updateField("new_pain", true)}>
                <span className="block text-center text-base">{SIGNAL.yes}</span>
              </Choice>
            </div>
            {form.new_pain === true && (
              <Note label={SIGNAL.describe} value={form.new_pain_note} onChange={(value) => flow.updateField("new_pain_note", value)} error={flow.fieldErrors.new_pain_note} />
            )}
            <p className="text-xs text-muted">{REASON.painReminder}</p>
          </div>
        )}
        {form.change_reason !== "" && (
          <Note
            label={form.change_reason === "other" ? REASON.noteRequired : REASON.noteOptional}
            value={form.change_reason_note}
            onChange={(value) => flow.updateField("change_reason_note", value)}
            error={flow.fieldErrors.change_reason_note}
          />
        )}
      </div>
    ),
    effort: (
      <ScaleChoice
        label={copy.title}
        hideLabel
        value={form.rpe}
        anchors={EFFORT.anchors}
        valueLabel={effortLabel}
        onChange={(value) => {
          flow.updateField("rpe", value);
          advanceSoon();
        }}
      />
    ),
    signal: (
      <div className="flex flex-col gap-4">
        <div role="group" aria-label={copy.question} className="grid grid-cols-2 gap-2">
          <Choice pressed={form.new_pain === false} onClick={() => flow.updateField("new_pain", false)}>
            <span className="block text-center text-base">{SIGNAL.no}</span>
          </Choice>
          <Choice pressed={form.new_pain === true} onClick={() => flow.updateField("new_pain", true)}>
            <span className="block text-center text-base">{SIGNAL.yes}</span>
          </Choice>
        </div>
        {form.new_pain === true && (
          <Note label={SIGNAL.describe} value={form.new_pain_note} onChange={(value) => flow.updateField("new_pain_note", value)} error={flow.fieldErrors.new_pain_note} />
        )}
      </div>
    ),
  };

  return (
    <form onSubmit={next} className="flex min-h-full flex-col" aria-label={copy.title}>
      <div className="flex gap-1.5" aria-hidden="true">
        {steps.map((id, position) => (
          <span key={id} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${position <= index ? "bg-gold" : "bg-line"}`} />
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-gold" data-testid="after-session-title">
        {flowTitle(flow.sessionLabel)}
      </p>
      {/* A11 — the total is shown once the path is known (after « Séance terminée ? »), never a total that grows. */}
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted" data-testid="after-session-progress">
        {statusChosen ? `Étape ${Math.min(index, steps.length - 1) + 1} / ${steps.length}` : "Étape 1"}
      </p>

      <div key={step} className="ux-enter mt-2 flex flex-1 flex-col gap-6">
        <div>
          <h2 className="font-display text-5xl font-extrabold uppercase leading-none text-ink">{copy.title}</h2>
          <p className="mt-2 text-base text-ink/70">{copy.question}</p>
        </div>
        {sections[step]}
      </div>

      <div className="sticky bottom-0 -mx-5 mt-8 flex flex-col gap-3 border-t border-line bg-bg/95 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur-md">
        {flow.saveState === "error" && flow.saveError && (
          // A11 — a failed send is visible, the answers stay, and the same send can be retried.
          <div role="alert" className="flex items-center justify-between gap-3 text-sm text-red-400">
            <span>{flow.saveError.message}</span>
            {flow.saveError.retryable && (
              <button type="button" onClick={() => void flow.submit()} className="ux-press min-h-11 shrink-0 font-semibold text-gold underline-offset-4 hover:underline">
                {BUTTONS.retry}
              </button>
            )}
          </div>
        )}
        <div className="flex gap-3">
          {index > 0 && (
            <SecondaryButton onClick={() => setIndex(Math.min(index, steps.length - 1) - 1)} className="min-h-12 px-5">
              {BUTTONS.back}
            </SecondaryButton>
          )}
          <PrimaryButton type="submit" disabled={isLast ? !flow.canSave : !answered} className="flex-1 tracking-[0.08em]">
            {isLast ? (flow.saveState === "saving" ? BUTTONS.saving : BUTTONS.save) : BUTTONS.next}
          </PrimaryButton>
        </div>
      </div>
    </form>
  );
}
