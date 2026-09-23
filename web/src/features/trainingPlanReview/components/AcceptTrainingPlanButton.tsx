import { useState } from "react";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { SecondaryButton } from "../../../components/SecondaryButton";
import { acceptTrainingPlan, type AcceptTrainingPlanResponse } from "../acceptTrainingPlan";
import type { AcceptTrainingPlanError } from "../acceptTrainingPlanErrors";
import type { TrainingPlanReview } from "../trainingPlanReviewTypes";
import { formatShortDate } from "../trainingPlanReviewFormat";

type ButtonState = "idle" | "confirming" | "accepting" | "error";

interface AcceptTrainingPlanButtonProps {
  review: TrainingPlanReview;
  /** Whether the athlete already has a different plan currently active — surfaced as a warning in the confirmation step, never a blocker. */
  hasActivePlan: boolean;
  onAccepted: (result: AcceptTrainingPlanResponse) => void;
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
 */
export function AcceptTrainingPlanButton({ review, hasActivePlan, onAccepted }: AcceptTrainingPlanButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState<AcceptTrainingPlanError | null>(null);

  if (review.lifecycleState !== "draft") {
    return null;
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
    return <PrimaryButton onClick={() => setState("confirming")}>Accepter ce plan</PrimaryButton>;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-card p-3">
      <p className="text-sm text-ink">
        Du {formatShortDate(review.version.horizonStartDate)} au {formatShortDate(review.version.horizonEndDate)}.
      </p>
      {hasActivePlan && (
        <p role="alert" className="text-sm text-amber-300">
          Ce plan remplacera ton plan actuellement actif.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <PrimaryButton onClick={() => void handleConfirm()} disabled={state === "accepting"} className="flex-1">
          {state === "accepting" ? "Acceptation…" : "Confirmer"}
        </PrimaryButton>
        <SecondaryButton onClick={() => setState("idle")} disabled={state === "accepting"} className="flex-1">
          Annuler
        </SecondaryButton>
      </div>
    </div>
  );
}
