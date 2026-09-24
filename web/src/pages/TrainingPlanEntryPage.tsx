import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { AppHeader } from "../components/AppHeader";
import { SecondaryButton } from "../components/SecondaryButton";
import { getActivePlanVersionId, getTrainingPlanDrafts } from "../features/trainingPlanReview/trainingPlanReviewRepo";

type Destination = { status: "loading" } | { status: "error" } | { status: "redirect"; to: string };

/**
 * /training-plan — the permanent "Programme" entry. Resolves where the athlete's plan
 * actually is, from the existing sources of truth only: the current plan pointer
 * (training_plan_current_version) → its exact preview; otherwise the existing
 * latest-draft preview; otherwise the setup page to create a first plan.
 */
export function TrainingPlanEntryPage() {
  const [destination, setDestination] = useState<Destination>({ status: "loading" });

  const resolve = useCallback(async () => {
    setDestination({ status: "loading" });
    try {
      const activePlanVersionId = await getActivePlanVersionId();
      if (activePlanVersionId) {
        setDestination({ status: "redirect", to: `/training-plan-preview/${encodeURIComponent(activePlanVersionId)}` });
        return;
      }
      const drafts = await getTrainingPlanDrafts();
      setDestination({ status: "redirect", to: drafts.length > 0 ? "/training-plan-preview" : "/performance-setup" });
    } catch {
      setDestination({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  if (destination.status === "redirect") {
    return <Navigate to={destination.to} replace />;
  }

  return (
    <PageShell header={<AppHeader />}>
      {destination.status === "loading" ? (
        <p className="text-center text-sm text-muted">Chargement…</p>
      ) : (
        <>
          <p role="alert" className="text-sm text-red-400">
            Impossible de charger ton plan d'entraînement. Réessaie.
          </p>
          <SecondaryButton onClick={() => void resolve()} className="self-start">
            Réessayer
          </SecondaryButton>
        </>
      )}
    </PageShell>
  );
}
