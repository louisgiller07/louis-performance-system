import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { AppHeader } from "../components/AppHeader";
import { SectionHeader } from "../components/SectionHeader";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import {
  getTrainingPlanDrafts,
  getTrainingPlanReview,
  getActivePlanVersionId,
} from "../features/trainingPlanReview/trainingPlanReviewRepo";
import type { TrainingPlanDraftSummary, TrainingPlanReview } from "../features/trainingPlanReview/trainingPlanReviewTypes";
import { TrainingPlanOverview } from "../features/trainingPlanReview/components/TrainingPlanOverview";
import { TrainingPlanWeekCard } from "../features/trainingPlanReview/components/TrainingPlanWeekCard";
import { DraftList } from "../features/trainingPlanReview/components/DraftList";

type PageState = "loading" | "empty" | "ready" | "error";

const LOAD_ERROR_MESSAGE = "Impossible de charger ton plan d'entraînement. Réessaie.";
const SELECT_ERROR_MESSAGE = "Impossible de charger ce plan. Réessaie.";

/**
 * /training-plan-preview (V0.5_028) — the athlete's read-only view of a
 * generated Training Plan before acceptance. Page-level orchestration only:
 * data access goes exclusively through trainingPlanReviewRepo.ts (V0.5_027)
 * and acceptTrainingPlan.ts, never a direct Supabase call from this file or
 * any child component — the components (TrainingPlanOverview/WeekCard/
 * SessionCard/DraftList/AcceptTrainingPlanButton) only ever receive already
 * -assembled data as props, never a table name, never a relation to
 * reconstruct themselves (ticket lock).
 *
 * Deliberately not `/plan` (V0.3_003's manual planned_sessions workflow) —
 * a separate route, separate data source, separate component tree, per
 * V0.5_025/026's own explicit "cohabitation dangereuse" finding.
 */
export function TrainingPlanPreviewPage() {
  const [state, setState] = useState<PageState>("loading");
  const [drafts, setDrafts] = useState<TrainingPlanDraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [review, setReview] = useState<TrainingPlanReview | null>(null);
  const [hasActivePlan, setHasActivePlan] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>(LOAD_ERROR_MESSAGE);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [draftList, activePlanVersionId] = await Promise.all([getTrainingPlanDrafts(), getActivePlanVersionId()]);
      setDrafts(draftList);
      setHasActivePlan(activePlanVersionId !== null);

      if (draftList.length === 0) {
        setReview(null);
        setSelectedId(null);
        setState("empty");
        return;
      }

      // Most recent first (getTrainingPlanDrafts()'s own ordering) — never
      // assumes exactly one draft exists (ticket lock).
      const targetId = draftList[0]!.id;
      const loadedReview = await getTrainingPlanReview(targetId);
      setSelectedId(targetId);
      setReview(loadedReview);
      setState("ready");
    } catch {
      setErrorMessage(LOAD_ERROR_MESSAGE);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSelectDraft(planVersionId: string) {
    try {
      const loadedReview = await getTrainingPlanReview(planVersionId);
      setSelectedId(planVersionId);
      setReview(loadedReview);
    } catch {
      setErrorMessage(SELECT_ERROR_MESSAGE);
      setState("error");
    }
  }

  function handleAccepted() {
    // Re-fetch from the real source of truth rather than guessing the new
    // lifecycle state client-side — the accepted version's state, its
    // sibling drafts, and the active-plan pointer all changed server-side.
    void load();
  }

  if (state === "loading") {
    return (
      <PageShell header={<AppHeader />}>
        <p className="text-center text-sm text-muted">Chargement…</p>
      </PageShell>
    );
  }

  if (state === "empty") {
    return (
      <PageShell header={<AppHeader />}>
        <SectionHeader title="Ton plan d'entraînement" />
        <p className="text-sm text-ink/80">Aucun plan généré pour le moment.</p>
        <Link to="/performance-setup">
          <PrimaryButton className="w-full">Configurer mon profil</PrimaryButton>
        </Link>
      </PageShell>
    );
  }

  if (state === "error") {
    return (
      <PageShell header={<AppHeader />}>
        <p role="alert" className="text-sm text-red-400">
          {errorMessage}
        </p>
        <SecondaryButton onClick={() => void load()} className="self-start">
          Réessayer
        </SecondaryButton>
      </PageShell>
    );
  }

  return (
    <PageShell header={<AppHeader />}>
      {drafts.length > 1 && selectedId && <DraftList drafts={drafts} selectedId={selectedId} onSelect={(id) => void handleSelectDraft(id)} />}

      {review && (
        <>
          <TrainingPlanOverview review={review} hasActivePlan={hasActivePlan} onAccepted={handleAccepted} />
          <div className="flex flex-col gap-4">
            {review.blocks
              .flatMap((block) => block.weeks)
              .map((week) => (
                <TrainingPlanWeekCard key={week.id} week={week} />
              ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
