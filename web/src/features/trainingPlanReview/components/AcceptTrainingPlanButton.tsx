import { useState } from "react";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SecondaryButton } from "../../../components/SecondaryButton";
import { todayLocal } from "../../../lib/date";
import { acceptTrainingPlan, type AcceptTrainingPlanResponse } from "../acceptTrainingPlan";
import type { AcceptTrainingPlanError } from "../acceptTrainingPlanErrors";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";
import { formatShortDate } from "../trainingPlanReviewFormat";
import { getManualDatesReplacedByAcceptance } from "../trainingPlanReviewRepo";

type ButtonState = "idle" | "confirming" | "accepting" | "error";

/** CONSISTENCY-01 — whether accepting replaces manual sessions: being checked, none, some, or unknown (read failed). */
type ReplacedModifications = "checking" | "none" | "some" | "unknown";

/** CONSISTENCY-01 (HPM 2026-10-16) — the rider's own future modifications this acceptance replaces. */
export const REPLACED_MODIFICATIONS_WARNING =
  "En acceptant ce nouveau programme, tes modifications manuelles des prochaines séances de l'ancien programme seront remplacées. Les séances déjà commencées ou terminées restent conservées.";
/** Same, for a first programme (the manual sessions come from the rider's own planning, not from a programme). */
export const REPLACED_MODIFICATIONS_WARNING_FIRST_PLAN =
  "En acceptant ce programme, les séances que tu as ajoutées à la main sur ses dates seront remplacées. Les séances déjà commencées ou terminées restent conservées.";
/** Fail closed: the check could not be read, the rider is told what may happen. */
export const REPLACED_MODIFICATIONS_WARNING_UNKNOWN =
  "Si tu as modifié à la main des séances à venir sur les dates de ce programme, elles seront remplacées. Les séances déjà commencées ou terminées restent conservées.";
export const CONFIRM_REPLACING_LABEL = "Confirmer et remplacer mes modifications";

/** Product calendar's today (Europe/Zurich) — the projection window start of the acceptance (accept-training-plan). */
const productToday = () => todayLocal("Europe/Zurich");

interface AcceptTrainingPlanButtonProps {
  review: TrainingPlanReview;
  /** Whether the athlete already has a different plan currently active — surfaced as a warning in the confirmation step, never a blocker. */
  hasActivePlan: boolean;
  onAccepted: (result: AcceptTrainingPlanResponse) => void;
  /** UX-09 — "Commencer ma préparation" for a rider's first plan. */
  label?: string;
}

/**
 * The one and only place "Accepter" lives (ticket lock) — never rendered
 * inside a week or session card. Owns its own small confirm-before-act
 * micro-flow (ticket: "pas de confirmation complexe" — no modal, no shared
 * dialog component exists anywhere in this codebase; an inline two-step
 * reveal is the simplest option consistent with that). Renders nothing
 * actionable when the reviewed version is no longer a draft — the caller
 * (TrainingPlanOverview) is responsible for showing the lifecycle state
 * itself.
 *
 * CONSISTENCY-01 — the confirmation step also says, before the operation, when
 * accepting replaces the rider's manual sessions from today inside the new
 * programme's horizon (project_training_plan, now or at the next daily-run);
 * the button then names the consequence. No extra step otherwise.
 */
export function AcceptTrainingPlanButton({ review, hasActivePlan, onAccepted, label = "Accepter ce plan" }: AcceptTrainingPlanButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState<AcceptTrainingPlanError | null>(null);
  const [replaced, setReplaced] = useState<ReplacedModifications>("checking");

  if (review.lifecycleState !== "draft") {
    return null;
  }

  function startConfirming() {
    setState("confirming");
    setReplaced("checking");
    const today = productToday();
    const from = review.version.horizonStartDate > today ? review.version.horizonStartDate : today;
    getManualDatesReplacedByAcceptance(from, review.version.horizonEndDate)
      .then((dates) => setReplaced(dates.length > 0 ? "some" : "none"))
      .catch(() => setReplaced("unknown"));
  }

  async function handleConfirm() {
    setState("accepting");
    setError(null);
    const result = await acceptTrainingPlan(review.version.id);
    if (result.ok) {
      onAccepted(result.data);
      return;
    }
    setError(result.error);
    setState("error");
  }

  if (state === "idle") {
    return <PrimaryButton onClick={startConfirming}>{label}</PrimaryButton>;
  }

  const warning =
    replaced === "some"
      ? hasActivePlan
        ? REPLACED_MODIFICATIONS_WARNING
        : REPLACED_MODIFICATIONS_WARNING_FIRST_PLAN
      : replaced === "unknown"
        ? REPLACED_MODIFICATIONS_WARNING_UNKNOWN
        : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-card p-3">
      <p className="text-sm text-ink">
        Ton programme commence le {formatShortDate(review.version.horizonStartDate)} et se termine le {formatShortDate(review.version.horizonEndDate)}.
      </p>
      {hasActivePlan && (
        <p role="alert" className="text-sm text-amber-300">
          Ce plan remplacera ton plan actuellement actif.
        </p>
      )}
      {replaced === "checking" && <p className="text-sm text-muted">Vérification de tes séances modifiées…</p>}
      {warning && (
        <p role="alert" className="text-sm text-amber-300">
          {warning}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <PrimaryButton onClick={() => void handleConfirm()} disabled={state === "accepting" || replaced === "checking"} className="flex-1">
          {state === "accepting" ? "Acceptation…" : warning ? CONFIRM_REPLACING_LABEL : "Confirmer"}
        </PrimaryButton>
        <SecondaryButton onClick={() => setState("idle")} disabled={state === "accepting"} className="flex-1">
          Annuler
        </SecondaryButton>
      </div>
    </div>
  );
}
