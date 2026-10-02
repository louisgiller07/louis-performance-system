// UX-11C.1 — guided-session screen (shell): header, the session module's
// content, lifecycle actions. Mobile first: full-width 48 px actions, the
// state written in words (never only a colour), confirmations take the
// keyboard focus and Escape cancels them.
// UX-11C.2 — completion is decided by the session module (≥ 1 work result
// for Force; partial results need a confirmation) and carries the module's
// not-yet-sent results in the same batch; an abandoned attempt whose
// prescription is still current can be restarted (new execution).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { UNSUPPORTED_SESSION_MESSAGE, UNAVAILABLE_MESSAGES, ACTION_ERROR_MESSAGES, PHASE_LABELS } from "./guidedSessionCopy";
import { resolveSessionModule, type ModulePending, type SubmitOutcome } from "./sessionModules";
import type { GuidedActionError, GuidedLoadState } from "./useGuidedSession";
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { ExecutionPhase } from "./executionState";
import type { SessionExecutionBatch } from "./sessionExecutionClient";

export interface GuidedSessionViewProps {
  load: GuidedLoadState;
  busy: boolean;
  actionError: GuidedActionError | null;
  onStart: (finalPrescriptionId: string) => void;
  onPause: (executionId: string) => void;
  onResume: (executionId: string) => void;
  onAbandon: (executionId: string) => void;
  onComplete: (executionId: string, pending: ModulePending) => void;
  onSubmit: (action: string, batch: SessionExecutionBatch) => Promise<SubmitOutcome>;
  onRetry: () => void;
  onReload: () => void;
  newId: () => string;
  now: () => string;
}

function Header({ prescription, phase }: { prescription: FinalPrescriptionV2View | null; phase: ExecutionPhase }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Séance guidée</p>
      {prescription && (
        <>
          <h1 className="text-2xl font-bold uppercase tracking-tight text-ink">
            {TRAINING_KIND_LABELS[prescription.sessionKind as keyof typeof TRAINING_KIND_LABELS] ?? "Séance"}
          </h1>
          <p className="text-ink/80">{prescription.intent}</p>
        </>
      )}
      <p className="text-sm font-semibold text-ink" role="status" data-phase={phase}>
        État : {PHASE_LABELS[phase]}
      </p>
    </header>
  );
}

/** A confirmation: focus on the safe choice, Escape cancels. */
function Confirmation({ id, message, confirmLabel, cancelLabel, onConfirm, onCancel, disabled }: { id: string; message: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void; disabled: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => containerRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus(), []);
  return (
    <div ref={containerRef} role="alertdialog" aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <p id={id} className="text-sm text-ink">
        {message}
      </p>
      <SecondaryButton onClick={onConfirm} disabled={disabled} className="min-h-12 w-full">
        {confirmLabel}
      </SecondaryButton>
      <PrimaryButton data-autofocus onClick={onCancel} className="w-full">
        {cancelLabel}
      </PrimaryButton>
    </div>
  );
}

export function GuidedSessionView({ load, busy, actionError, onStart, onPause, onResume, onAbandon, onComplete, onSubmit, onRetry, onReload, newId, now }: GuidedSessionViewProps) {
  const [confirming, setConfirming] = useState<"stop" | "complete" | null>(null);
  // Module-owned UI state (e.g. the set being entered), opaque to the shell.
  const [moduleState, setModuleState] = useState<unknown>(null);

  if (load.status === "loading") return <p className="text-sm text-muted">Chargement de ta séance…</p>;
  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm text-red-400">
          Impossible de charger ta séance. Réessaie.
        </p>
        <SecondaryButton onClick={onReload} className="min-h-12 w-full">
          Réessayer
        </SecondaryButton>
      </div>
    );
  }

  const snapshot = load.snapshot;
  const backToToday = (
    <Link to="/today" className="ux-press inline-flex min-h-12 items-center text-sm text-ink/80 underline-offset-4 hover:underline">
      Retour à Aujourd'hui
    </Link>
  );

  if (snapshot.kind === "unavailable") {
    return (
      <div className="flex flex-col gap-3">
        <Header prescription={null} phase="not_started" />
        <p className="text-ink/80" data-reason={snapshot.reason}>
          {UNAVAILABLE_MESSAGES[snapshot.reason]}
        </p>
        {backToToday}
      </div>
    );
  }

  const prescription = snapshot.kind === "ready_to_start" ? snapshot.prescription : snapshot.prescription.kind === "created" ? snapshot.prescription.prescription : null;
  const phase: ExecutionPhase = snapshot.kind === "ready_to_start" ? "not_started" : snapshot.phase;
  const executionId = snapshot.kind === "execution" ? snapshot.execution.id : null;
  const setResults = snapshot.kind === "execution" ? snapshot.execution.exercise_set_results : [];
  const activityResults = snapshot.kind === "execution" ? snapshot.execution.session_activity_results : [];
  const restartId = snapshot.kind === "execution" ? snapshot.restartFinalPrescriptionId : undefined;
  const open = phase === "active" || phase === "paused";
  const module = prescription ? resolveSessionModule(prescription) : null;
  const context = prescription ? { prescription, executionId, phase, setResults, activityResults, uiState: moduleState } : null;
  const completion = module && context ? module.completion(context, now) : null;
  const canComplete = open && executionId !== null && completion?.canComplete === true;

  const completeNow = () => {
    if (!executionId || !module || !context) return;
    // Rebuilt at the moment of completing: the pending results carry their own stable ids.
    setConfirming(null);
    onComplete(executionId, module.completion(context, now).pending);
  };

  return (
    <div className="flex flex-col gap-4">
      <Header prescription={prescription} phase={phase} />

      {actionError && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3" data-code={actionError.code}>
          <p className="text-sm text-ink">{ACTION_ERROR_MESSAGES[actionError.code] ?? (actionError.retryable ? ACTION_ERROR_MESSAGES.network_error : ACTION_ERROR_MESSAGES.refused)}</p>
          {actionError.retryable && (
            <SecondaryButton onClick={onRetry} disabled={busy} className="min-h-12 w-full">
              Réessayer
            </SecondaryButton>
          )}
        </div>
      )}

      {module && context ? (
        <module.Content {...context} editable={open} busy={busy} setUiState={setModuleState} submit={onSubmit} newId={newId} now={now} />
      ) : (
        <p className="text-ink/80" data-reason="unsupported">
          {UNSUPPORTED_SESSION_MESSAGE}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {snapshot.kind === "ready_to_start" && (
          <PrimaryButton onClick={() => onStart(snapshot.finalPrescriptionId)} disabled={busy} className="w-full">
            {busy ? "Démarrage…" : "Commencer la séance"}
          </PrimaryButton>
        )}
        {phase === "abandoned" && restartId && (
          <PrimaryButton onClick={() => onStart(restartId)} disabled={busy} className="w-full">
            Recommencer la séance
          </PrimaryButton>
        )}
        {phase === "active" && executionId && (
          <PrimaryButton onClick={() => onPause(executionId)} disabled={busy} className="w-full">
            Mettre en pause
          </PrimaryButton>
        )}
        {phase === "paused" && executionId && (
          <PrimaryButton onClick={() => onResume(executionId)} disabled={busy} className="w-full">
            Reprendre
          </PrimaryButton>
        )}
        {open && confirming !== "complete" && (
          <>
            <SecondaryButton
              disabled={!canComplete || busy}
              aria-describedby={canComplete ? undefined : "completion-not-ready"}
              onClick={() => (completion?.completionNeedsConfirmation ? setConfirming("complete") : completeNow())}
              className="min-h-12 w-full"
            >
              Terminer la séance
            </SecondaryButton>
            {!canComplete && completion && (
              <p id="completion-not-ready" className="text-xs text-muted">
                {completion.hint}
              </p>
            )}
          </>
        )}
        {open && confirming === "complete" && (
          <Confirmation
            id="complete-title"
            message={completion?.confirmationMessage ?? ""}
            confirmLabel="Terminer quand même"
            cancelLabel="Revenir à la séance"
            disabled={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={completeNow}
          />
        )}
        {open && executionId && confirming !== "stop" && (
          <SecondaryButton onClick={() => setConfirming("stop")} disabled={busy} className="min-h-12 w-full">
            Arrêter la séance
          </SecondaryButton>
        )}
        {open && executionId && confirming === "stop" && (
          <Confirmation
            id="stop-title"
            message="Arrêter la séance ? Elle sera enregistrée comme arrêtée et ne pourra plus être reprise. Les résultats déjà enregistrés restent dans l'historique."
            confirmLabel="Confirmer l'arrêt"
            cancelLabel="Continuer la séance"
            disabled={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              onAbandon(executionId);
            }}
          />
        )}
      </div>

      {!open && backToToday}
    </div>
  );
}
