import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { AppHeader } from "../components/AppHeader";
import { SectionHeader } from "../components/SectionHeader";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import {
  getTrainingPlanDrafts,
  getTrainingPlanReview,
  getActivePlanVersionId,
  TrainingPlanVersionNotFoundError,
} from "../features/trainingPlanReview/trainingPlanReviewRepo";
import type { TrainingPlanDraftSummary, TrainingPlanReview } from "../features/trainingPlanReview/trainingPlanReviewTypes";
import { TrainingPlanOverview } from "../features/trainingPlanReview/components/TrainingPlanOverview";
import { TrainingPlanWeekCard } from "../features/trainingPlanReview/components/TrainingPlanWeekCard";
import { DraftList } from "../features/trainingPlanReview/components/DraftList";

type PageState = "loading" | "empty" | "ready" | "error" | "not_found";

const LOAD_ERROR_MESSAGE = "Impossible de charger ton plan d'entraînement. Réessaie.";
const NOT_FOUND_MESSAGE = "Ce plan est introuvable ou n'est plus accessible.";

/**
 * /training-plan-preview[/:planVersionId] (V0.5_028, id-targeting V0.5_038)
 * — the athlete's read-only view of a generated Training Plan before
 * acceptance. Page-level orchestration only: data access goes exclusively
 * through trainingPlanReviewRepo.ts (V0.5_027) and acceptTrainingPlan.ts,
 * never a direct Supabase call from this file or any child component — the
 * components (TrainingPlanOverview/WeekCard/SessionCard/DraftList/
 * AcceptTrainingPlanButton) only ever receive already-assembled data as
 * props, never a table name, never a relation to reconstruct themselves
 * (ticket lock).
 *
 * Deliberately not `/plan` (V0.3_003's manual planned_sessions workflow) —
 * a separate route, separate data source, separate component tree, per
 * V0.5_025/026's own explicit "cohabitation dangereuse" finding.
 *
 * V0.5_038 — an explicit `:planVersionId` in the URL (same precedent as
 * `/history/:decisionId`) is now the source of truth whenever present: this
 * closes a real race condition where a just-generated plan could be
 * silently replaced by whatever happens to be "the latest draft" by the
 * time this page loads (e.g. a second, later generation completing first).
 * `draftList[0]` is used as the target ONLY when the route carries no id —
 * it must never override an explicit `:planVersionId`, and a targeted id
 * that no longer resolves (not found, or lifecycle moved out of RLS
 * visibility) must show a dedicated "introuvable" state, never silently
 * fall back to a different draft.
 */
export function TrainingPlanPreviewPage() {
  const { planVersionId: routePlanVersionId } = useParams<{ planVersionId: string }>();
  const navigate = useNavigate();
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

      if (routePlanVersionId) {
        // The URL is the exact reference — never overridden by draftList[0],
        // and never limited to `draft`-state versions (getTrainingPlanReview
        // reads any lifecycle state).
        try {
          const loadedReview = await getTrainingPlanReview(routePlanVersionId);
          setSelectedId(routePlanVersionId);
          setReview(loadedReview);
          setState("ready");
        } catch (err) {
          if (err instanceof TrainingPlanVersionNotFoundError) {
            setReview(null);
            setSelectedId(null);
            setState("not_found");
            return;
          }
          throw err;
        }
        return;
      }

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
  }, [routePlanVersionId]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSelectDraft(planVersionId: string) {
    // Navigates rather than fetching locally — the URL becomes the one
    // source of truth for "which plan is shown" (V0.5_038), so a refresh or
    // a shared link reproduces exactly this selection. The route change
    // re-runs `load()` above with the new routePlanVersionId.
    navigate(`/training-plan-preview/${encodeURIComponent(planVersionId)}`);
  }

  function handleAccepted() {
    // Re-fetch from the real source of truth rather than guessing the new
    // lifecycle state client-side — the accepted version's state, its
    // sibling drafts, and the active-plan pointer all changed server-side.
    // Reuses the same routePlanVersionId when present, so an accepted
    // targeted plan keeps being the one shown — never redirected elsewhere.
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

  if (state === "not_found") {
    return (
      <PageShell header={<AppHeader />}>
        <SectionHeader title="Ton plan d'entraînement" />
        <p className="text-sm text-ink/80">{NOT_FOUND_MESSAGE}</p>
        <Link to="/training-plan-preview">
          <SecondaryButton className="w-full">Voir les plans disponibles</SecondaryButton>
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell header={<AppHeader />}>
      {drafts.length > 1 && selectedId && <DraftList drafts={drafts} selectedId={selectedId} onSelect={handleSelectDraft} />}

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
