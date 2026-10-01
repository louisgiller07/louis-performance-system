// UX-11C.1 — guided-session screen (shell only): header, the session
// module's content, lifecycle actions. Mobile first: full-width 48 px
// actions, the state written in words (never only a colour), the stop
// confirmation takes the keyboard focus.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { TRAINING_KIND_LABELS } from "../dailyPlan/dailyPlanLabels";
import { UNSUPPORTED_SESSION_MESSAGE, UNAVAILABLE_MESSAGES, ACTION_ERROR_MESSAGES, PHASE_LABELS, COMPLETION_NOT_READY_MESSAGE } from "./guidedSessionCopy";
import { resolveSessionModule } from "./sessionModules";
import type { GuidedActionError, GuidedLoadState } from "./useGuidedSession";
import type { FinalPrescriptionV2View } from "../finalPrescriptionV2/finalPrescriptionV2Types";
import type { ExecutionPhase } from "./executionState";

export interface GuidedSessionViewProps {
  load: GuidedLoadState;
  busy: boolean;
  actionError: GuidedActionError | null;
  onStart: (finalPrescriptionId: string) => void;
  onPause: (executionId: string) => void;
  onResume: (executionId: string) => void;
  onAbandon: (executionId: string) => void;
  onRetry: () => void;
  onReload: () => void;
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

function StopConfirmation({ onConfirm, onCancel, disabled }: { onConfirm: () => void; onCancel: () => void; disabled: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keyboard focus moves into the confirmation, on the safe choice (continue).
  useEffect(() => containerRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus(), []);
  return (
    <div ref={containerRef} role="alertdialog" aria-labelledby="stop-title" className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <p id="stop-title" className="text-sm text-ink">
        Arrêter la séance ? Elle sera enregistrée comme arrêtée et ne pourra plus être reprise.
      </p>
      <SecondaryButton onClick={onConfirm} disabled={disabled} className="w-full">
        Confirmer l'arrêt
      </SecondaryButton>
      <PrimaryButton data-autofocus onClick={onCancel} className="w-full">
        Continuer la séance
      </PrimaryButton>
    </div>
  );
}

export function GuidedSessionView({ load, busy, actionError, onStart, onPause, onResume, onAbandon, onRetry, onReload }: GuidedSessionViewProps) {
  const [confirmingStop, setConfirmingStop] = useState(false);

  if (load.status === "loading") return <p className="text-sm text-muted">Chargement de ta séance…</p>;
  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-sm text-red-400">
          Impossible de charger ta séance. Réessaie.
        </p>
        <SecondaryButton onClick={onReload} className="w-full">
          Réessayer
        </SecondaryButton>
      </div>
    );
  }

  const snapshot = load.snapshot;
  const backToToday = (
    <Link to="/today" className="ux-press inline-flex min-h-11 items-center text-sm text-ink/80 underline-offset-4 hover:underline">
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
  const module = prescription ? resolveSessionModule(prescription) : null;
  const open = phase === "active" || phase === "paused";

  return (
    <div className="flex flex-col gap-4">
      <Header prescription={prescription} phase={phase} />

      {actionError && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3" data-code={actionError.code}>
          <p className="text-sm text-ink">{ACTION_ERROR_MESSAGES[actionError.code] ?? (actionError.retryable ? ACTION_ERROR_MESSAGES.network_error : ACTION_ERROR_MESSAGES.refused)}</p>
          {actionError.retryable && (
            <SecondaryButton onClick={onRetry} disabled={busy} className="w-full">
              Réessayer
            </SecondaryButton>
          )}
        </div>
      )}

      {module && prescription ? (
        <module.Content prescription={prescription} executionId={executionId} />
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
        {open && (
          <>
            {/* Completion stays with the session module (UX-11C.2+): never forced without the required results. */}
            <SecondaryButton disabled aria-describedby="completion-not-ready" className="w-full">
              Terminer la séance
            </SecondaryButton>
            <p id="completion-not-ready" className="text-xs text-muted">
              {module?.canComplete ? "" : COMPLETION_NOT_READY_MESSAGE}
            </p>
          </>
        )}
        {open && executionId && !confirmingStop && (
          <SecondaryButton onClick={() => setConfirmingStop(true)} disabled={busy} className="w-full">
            Arrêter la séance
          </SecondaryButton>
        )}
        {open && executionId && confirmingStop && (
          <StopConfirmation
            disabled={busy}
            onCancel={() => setConfirmingStop(false)}
            onConfirm={() => {
              setConfirmingStop(false);
              onAbandon(executionId);
            }}
          />
        )}
      </div>

      {!open && backToToday}
    </div>
  );
}
