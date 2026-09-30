import { StateCard } from "../components/StateCard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { SubPageLink } from "../components/SubPageLink";
import { AppHeader } from "../components/AppHeader";
import {
  getTrainingPlanDrafts,
  getTrainingPlanReview,
  getActivePlanVersionId,
  getManualPlannedDates,
  TrainingPlanVersionNotFoundError,
} from "../features/trainingPlanReview/trainingPlanReviewRepo";
import { findAthleteModifiedProgramDates } from "../features/trainingPlanReview/athleteModifiedProgramDays";
import type { TrainingPlanDraftSummary, TrainingPlanReview } from "../features/trainingPlanReview/trainingPlanReviewTypes";
import { useAuth } from "../auth/AuthContext";
import { useEffectiveToday } from "../lib/simulationClock";
import { raceHorizon } from "../features/today/todayContext";
import { useProgramContext } from "../features/program/programContextRepo";
import { ProgramHero } from "../features/program/ProgramHero";
import { ProgramDraftSummary } from "../features/program/ProgramDraftSummary";
import { ProgramWeekTimeline } from "../features/program/ProgramWeekTimeline";
import { ProgramSessions } from "../features/program/ProgramSessions";
import { ProgramCoachSummary } from "../features/program/ProgramCoachSummary";

type PageState = "loading" | "empty" | "ready" | "error" | "not_found";

const LOAD_ERROR_MESSAGE = "Impossible de charger ton plan d'entraînement. Réessaie.";
const NOT_FOUND_MESSAGE = "Ce plan est introuvable ou n'est plus accessible.";

/**
 * /training-plan-preview[/:planVersionId] (V0.5_028, id-targeting V0.5_038)
 * — the athlete's read-only view of a generated Training Plan before
 * acceptance. Page-level orchestration only: data access goes exclusively
 * through trainingPlanReviewRepo.ts (V0.5_027) and acceptTrainingPlan.ts,
 * never a direct Supabase call from this file or any child component — the
 * components (features/program/*, TrainingPlanOverview/WeekCard/SessionCard/
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
  const { athleteId } = useAuth();
  // Same canonical "today" as Today (real date; simulated only for the simulation athlete).
  const today = useEffectiveToday();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>("loading");
  const [drafts, setDrafts] = useState<TrainingPlanDraftSummary[]>([]);
  const [review, setReview] = useState<TrainingPlanReview | null>(null);
  const [hasActivePlan, setHasActivePlan] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>(LOAD_ERROR_MESSAGE);
  // V06-02 — keyed by plan version so a result can never be shown against a
  // different plan than the one it was computed for.
  const [modifications, setModifications] = useState<{ planVersionId: string; dates: string[] } | null>(null);

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
          setReview(loadedReview);
          setState("ready");
        } catch (err) {
          if (err instanceof TrainingPlanVersionNotFoundError) {
            setReview(null);
            setState("not_found");
            return;
          }
          throw err;
        }
        return;
      }

      if (draftList.length === 0) {
        setReview(null);
        setState("empty");
        return;
      }

      // Most recent first (getTrainingPlanDrafts()'s own ordering) — never
      // assumes exactly one draft exists (ticket lock).
      const targetId = draftList[0]!.id;
      const loadedReview = await getTrainingPlanReview(targetId);
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

  // V06-02 — supplementary, non-blocking read, only once the review is
  // already on screen and only for the accepted (projected) plan: a draft's
  // days are not in the athlete's planning yet, so comparing them would say
  // nothing about modifications. Any failure just leaves the message hidden.
  useEffect(() => {
    if (!review || review.lifecycleState !== "accepted") return;
    let cancelled = false;
    getManualPlannedDates(review.version.horizonStartDate, review.version.horizonEndDate)
      .then((manualDates) => {
        if (!cancelled) setModifications({ planVersionId: review.version.id, dates: findAthleteModifiedProgramDates(review, manualDates) });
      })
      .catch(() => {
        // Deliberately silent: the plan review stays fully usable without it.
      });
    return () => {
      cancelled = true;
    };
  }, [review]);

  const athleteModifiedDates =
    review && review.lifecycleState === "accepted" && modifications?.planVersionId === review.version.id ? modifications.dates : null;

  // UX-06 — read-only facts around the plan (race / objective, completed
  // sessions, the Head Coach decisions of today and past days). A draft is
  // not the plan the athlete trained with, so only the race / objective are
  // shown around it.
  const context = useProgramContext(athleteId, review, today);
  const horizon = useMemo(() => (context ? raceHorizon(context.races, today) : null), [context, today]);
  const isAccepted = review?.lifecycleState === "accepted";

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
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-6" aria-busy="true">
          <p className="sr-only">Chargement…</p>
          <div className="ux-skeleton h-3 w-1/4 rounded" />
          <div className="ux-skeleton h-10 w-4/5 rounded" />
          <div className="ux-skeleton h-4 w-1/2 rounded" />
        </div>
        <div className="ux-skeleton h-40 rounded-xl" aria-hidden="true" />
      </PageShell>
    );
  }

  if (state === "empty") {
    return (
      <PageShell header={<AppHeader />}>
        <StateCard title="Ta préparation commence ici" action={{ label: "Construire ma préparation", to: "/start" }}>
          Quelques questions sur ton entraînement, et NALYNT construit ton premier plan.
        </StateCard>
      </PageShell>
    );
  }

  if (state === "error") {
    return (
      <PageShell header={<AppHeader />}>
        <StateCard tone="error" title="Programme indisponible" action={{ label: "Réessayer", onClick: () => void load() }}>
          {errorMessage}
        </StateCard>
      </PageShell>
    );
  }

  if (state === "not_found") {
    return (
      <PageShell header={<AppHeader />}>
        <StateCard title="Plan introuvable" action={{ label: "Revenir à Programme", to: "/training-plan" }}>
          {NOT_FOUND_MESSAGE}
        </StateCard>
      </PageShell>
    );
  }

  // UX-06 — validated order: where you are going (hero), a pending new version
  // if any, this week, today (dominant), what is coming, what is done (folded),
  // the coach summary (folded), then the way to adjust.
  return (
    <PageShell header={<AppHeader />}>
      {review && (
        <>
          <ProgramHero review={review} horizon={horizon} objective={context?.objective ?? null} today={today} />
          <ProgramDraftSummary drafts={drafts} review={review} hasActivePlan={hasActivePlan} onSelect={handleSelectDraft} onAccepted={handleAccepted} />
          <ProgramWeekTimeline key={review.version.id} review={review} today={today} completed={isAccepted ? (context?.completed ?? []) : []} races={context?.races ?? []} />
          <ProgramSessions
            review={review}
            today={today}
            completed={isAccepted ? (context?.completed ?? []) : []}
            decisionsByDate={isAccepted && context ? context.decisionsByDate : new Map()}
            modifiedDates={athleteModifiedDates ?? []}
          />
          <ProgramCoachSummary review={review} athleteModifiedDates={athleteModifiedDates} />
        </>
      )}
      <SubPageLink to="/plan" label="Modifier ma semaine" hint="· tes 7 prochains jours" />
      <Link to="/performance-setup" className="ux-press inline-flex min-h-11 items-center justify-center rounded border border-line px-4 text-sm font-medium text-ink/85 hover:border-gold/60 hover:text-ink">
        Modifier ma configuration
      </Link>
    </PageShell>
  );
}
