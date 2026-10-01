import { StateCard } from "../components/StateCard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FIRST_DAY, TODAY_NO_PLAN } from "../features/firstRun/firstRunPresentation";
import { useAuth } from "../auth/AuthContext";
import { useEffectiveToday } from "../lib/simulationClock";
import { CheckinForm } from "../features/checkin/CheckinForm";
import { TodayPlanningSummary } from "../features/planning/TodayPlanningSummary";
import { DailyPlanPanel } from "../features/dailyPlan/DailyPlanPanel";
import { AfterSessionEntry } from "../features/afterSession/AfterSessionEntry";
import { PageShell } from "../components/PageShell";
import { AppHeader } from "../components/AppHeader";
import { HealthFlagBanner } from "../features/healthFlags/HealthFlagBanner";
import { loadOpenHealthFlags, type OpenHealthFlag } from "../features/healthFlags/openHealthFlagsRepo";
import { getActivePlanVersionId } from "../features/trainingPlanReview/trainingPlanReviewRepo";
import { PrimaryButton } from "../components/PrimaryButton";
import { CheckinSheet } from "../features/checkin/CheckinSheet";
import { CheckinHero } from "../features/checkin/CheckinHero";
import { AnalysisSequence } from "../features/dailyPlan/AnalysisSequence";
import type { CheckinRow } from "../features/checkin/checkinTypes";
import { useTodayContext } from "../features/today/todayContextRepo";
import { nextPlannedSession, raceHorizon, weekCheckinCount, weekSummary } from "../features/today/todayContext";
import { RaceBanner } from "../features/today/RaceBanner";
import { RegularityCard } from "../features/today/RegularityCard";
import { TodayGreeting } from "../features/today/TodayGreeting";
import { NextStepCard } from "../features/today/NextStepCard";
import { WeekStrip } from "../features/today/WeekStrip";

const FRIENDLY_DATE_FORMAT = new Intl.DateTimeFormat("fr-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

// M4_002 — real skeleton, no check-in logic yet (M4_003). Athlete
// resolution already happened in RequireAuth/AuthContext; this page never
// re-resolves it.
//
// V0.3.010 (SIM-001) — "today" now comes from the shared
// `useEffectiveToday()` (src/lib/simulationClock.ts) instead of an explicit
// `date` prop threaded down from SimulationLabPage. For any real athlete
// (including Louis) this resolves to exactly `todayLocal()`, identical to
// the pre-V0.3.010 behavior — only the configured simulation athlete ever
// sees a simulated date, and consistently so on every page that also calls
// this same hook (PlanPage), not just wherever this component happens to
// be rendered from.
export function TodayPage() {
  const { athleteId } = useAuth();
  // UX-09 — arriving from the first run: this is the rider's first day.
  const firstDay = (useLocation().state as { firstDay?: boolean } | null)?.firstDay === true;
  const [hasCheckin, setHasCheckin] = useState(false);
  // Bumped only on an actual save (CheckinForm's onSaved), never on the
  // initial load of an existing row — see DailyPlanPanel's checkinRevision
  // prop doc for why that distinction matters.
  const [checkinRevision, setCheckinRevision] = useState(0);
  // UX-03 — Today is state-driven: until CheckinForm has reported whether
  // today's check-in exists, a skeleton holds the hero's place; then either
  // the check-in invitation (no check-in yet) or the mission (DailyPlanPanel).
  const [checkinKnown, setCheckinKnown] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleCheckinAvailability = useCallback((available: boolean) => {
    setHasCheckin(available);
    setCheckinKnown(true);
  }, []);

  // A real save: bump the revision (DailyPlanPanel then runs the analysis
  // on its own — autoGenerateOnCheckinSave) and close the ritual.
  const handleCheckinSaved = useCallback(() => {
    setCheckinRevision((revision) => revision + 1);
    setSheetOpen(false);
    window.scrollTo?.({ top: 0 });
  }, []);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // UX-04 — today's check-in values as declared (loaded, then as saved), for "Ton état du jour".
  const [checkinValues, setCheckinValues] = useState<CheckinRow | null>(null);
  // UX-05 — mount point for the collapsible plan detail, at the bottom of the page.
  const [detailsTarget, setDetailsTarget] = useState<HTMLDivElement | null>(null);

  // V0.3_006A1 — read-only, independent of check-in/plan generation state:
  // a load failure here must never block the check-in/plan flow, and vice
  // versa. Silently shows nothing on error (best-effort transparency, not a
  // Safety-critical read) rather than surfacing a second error banner.
  const [openHealthFlags, setOpenHealthFlags] = useState<OpenHealthFlag[]>([]);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    loadOpenHealthFlags(athleteId)
      .then((flags) => {
        if (!cancelled) setOpenHealthFlags(flags);
      })
      .catch(() => {
        // Best-effort — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  // PILOT_012 — athletes without an accepted training plan get a clear entry to set one up.
  // Best-effort read of the existing current-plan pointer: on error nothing is shown and
  // the rest of Today is unaffected.
  const [hasActivePlan, setHasActivePlan] = useState<boolean | null>(null);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    getActivePlanVersionId()
      .then((planVersionId) => {
        if (!cancelled) setHasActivePlan(planVersionId !== null);
      })
      .catch(() => {
        // Best-effort — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  // Canonical YYYY-MM-DD — real date for any real athlete, simulated date
  // only for the configured simulation athlete (see simulationClock.ts).
  const canonicalDate = useEffectiveToday();

  const friendlyDate = useMemo(() => {
    // Parse the canonical date as a local calendar date (year, month, day
    // components), not via `new Date(canonicalDate)` — that constructor
    // treats a bare YYYY-MM-DD string as UTC midnight, which can render the
    // wrong weekday/day near a timezone boundary.
    const [year, month, day] = canonicalDate.split("-").map(Number);
    const formatted = FRIENDLY_DATE_FORMAT.format(new Date(year, month - 1, day));
    // UX-03 — "Mardi 29 septembre": capitalized weekday, never the ISO date.
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [canonicalDate]);

  // UX-04 — read-only coach context (first name, race / objective, week, next session). Best-effort.
  const todayContext = useTodayContext(athleteId, canonicalDate);
  const horizon = useMemo(() => (todayContext ? raceHorizon(todayContext.races, canonicalDate) : null), [todayContext, canonicalDate]);

  const heroSkeleton = (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-6" aria-busy="true">
      <p className="sr-only">Chargement de ta journée…</p>
      <div className="ux-skeleton h-3 w-1/3 rounded" />
      <div className="ux-skeleton h-12 w-4/5 rounded" />
      <div className="ux-skeleton h-4 w-2/3 rounded" />
      <div className="ux-skeleton mt-3 h-12 rounded" />
    </div>
  );

  return (
    <PageShell header={<AppHeader />}>
      {/*
       * UX-05 / UX-08 — validated hierarchy: Bonjour → race / objective →
       * mission → what the coach retained → state of the day → after the
       * session (UX-08: right after the mission block) → next step → this
       * week → regularity → [Voir les détails du plan]. The health follow-up
       * banner stays right before the mission (safety first).
       */}
      <TodayGreeting firstName={todayContext?.firstName ?? null} friendlyDate={friendlyDate} canonicalDate={canonicalDate} />
      {todayContext && <RaceBanner horizon={horizon} objective={todayContext.objective} />}

      {/* Safety first: an active health follow-up always sits above the mission. */}
      <HealthFlagBanner flags={openHealthFlags} />

      {hasActivePlan === false && (
        // UX-09 — no plan yet: the first run builds it (/start).
        <section aria-labelledby="no-plan-title" className="ux-enter rounded-2xl border border-gold/40 bg-card p-5">
          <h2 id="no-plan-title" className="font-display text-3xl font-extrabold uppercase leading-none text-ink">
            {TODAY_NO_PLAN.title}
          </h2>
          <p className="mt-2 text-sm text-ink/80">{TODAY_NO_PLAN.text}</p>
          <Link to="/start" className="mt-4 block">
            <PrimaryButton className="w-full">{`${TODAY_NO_PLAN.cta} →`}</PrimaryButton>
          </Link>
        </section>
      )}

      {!checkinKnown && heroSkeleton}

      {checkinKnown && !hasCheckin && (
        <CheckinHero
          {...(firstDay ? { kicker: FIRST_DAY.kicker, title: FIRST_DAY.title, text: FIRST_DAY.text } : {})}
          onStart={() => setSheetOpen(true)}
          planningSlot={athleteId && <TodayPlanningSummary athleteId={athleteId} date={canonicalDate} />}
        />
      )}

      {/*
       * The mission: restores today's current decision, or runs the analysis
       * right after a check-in is saved ("NALYNT analyse…" → MissionHero).
       */}
      {athleteId && (
        <DailyPlanPanel
          athleteId={athleteId}
          date={canonicalDate}
          hasCheckin={hasCheckin}
          checkinRevision={checkinRevision}
          hideIdleWithoutCheckin
          autoGenerateOnCheckinSave
          minAnalysisMs={1800}
          runningSlot={<AnalysisSequence />}
          loadingSlot={checkinKnown ? heroSkeleton : null}
          checkinSnapshot={checkinValues}
          detailsTarget={detailsTarget}
          guidedSessionEntry={
            <Link
              to="/today/session"
              className="ux-press flex min-h-12 items-center justify-center rounded bg-gold px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-bg hover:bg-gold-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
            >
              Ouvrir la séance guidée
            </Link>
          }
        />
      )}

      {/* UX-08 — closing the loop: what was really done, right after the mission. */}
      {athleteId && <AfterSessionEntry date={canonicalDate} athleteId={athleteId} />}

      {/* UX-04/05 — where today leads: next step, the week, and plain regularity. */}
      {todayContext && (
        <>
          <NextStepCard next={nextPlannedSession(todayContext.planned, canonicalDate)} today={canonicalDate} horizon={horizon} objective={todayContext.objective} />
          <WeekStrip week={weekSummary(canonicalDate, todayContext.planned, todayContext.completed, todayContext.races)} />
          <RegularityCard
            checkedInToday={hasCheckin}
            weekCount={weekCheckinCount(todayContext.checkinDates, canonicalDate, hasCheckin)}
            onEditCheckin={() => setSheetOpen(true)}
          />
        </>
      )}

      {/* UX-05 — the collapsible plan detail ("Voir les détails du plan") is rendered here, last. */}
      <div ref={setDetailsTarget} />

      {!athleteId && (
        <StateCard tone="error" title="Profil introuvable">
          Nous n'avons pas réussi à retrouver ton profil. Contacte le support si le problème continue.
        </StateCard>
      )}

      <CheckinSheet open={sheetOpen} onClose={closeSheet}>
        {athleteId && (
          <CheckinForm
            athleteId={athleteId}
            date={canonicalDate}
            mode="guided"
            onCheckinAvailabilityChange={handleCheckinAvailability}
            onSaved={handleCheckinSaved}
            onValuesChange={setCheckinValues}
          />
        )}
      </CheckinSheet>
    </PageShell>
  );
}
