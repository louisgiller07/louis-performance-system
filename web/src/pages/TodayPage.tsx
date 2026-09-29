import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useEffectiveToday } from "../lib/simulationClock";
import { CheckinForm } from "../features/checkin/CheckinForm";
import { TodayPlanningSummary } from "../features/planning/TodayPlanningSummary";
import { DailyPlanPanel } from "../features/dailyPlan/DailyPlanPanel";
import { CompletedSessionCard } from "../features/completedSession/CompletedSessionCard";
import { PageShell } from "../components/PageShell";
import { AppHeader } from "../components/AppHeader";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { HealthFlagBanner } from "../features/healthFlags/HealthFlagBanner";
import { loadOpenHealthFlags, type OpenHealthFlag } from "../features/healthFlags/openHealthFlagsRepo";
import { getActivePlanVersionId } from "../features/trainingPlanReview/trainingPlanReviewRepo";
import { PrimaryButton } from "../components/PrimaryButton";
import { SecondaryButton } from "../components/SecondaryButton";
import { CheckinSheet } from "../features/checkin/CheckinSheet";
import { CheckinHero } from "../features/checkin/CheckinHero";
import { AnalysisSequence } from "../features/dailyPlan/AnalysisSequence";

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
    <PageShell header={<AppHeader trailing={<time dateTime={canonicalDate}>{friendlyDate}</time>} />}>
      {/* Safety first: an active health follow-up always sits above everything else. */}
      <HealthFlagBanner flags={openHealthFlags} />

      {hasActivePlan === false && (
        <Card className="flex flex-col gap-3">
          <SectionHeader title="Ton plan d'entraînement" />
          <p className="text-sm text-ink/80">
            Complète ton profil et tes disponibilités pour créer ton premier plan d'entraînement.
          </p>
          <Link to="/performance-setup">
            <PrimaryButton className="w-full">Configurer mon profil et générer mon plan</PrimaryButton>
          </Link>
        </Card>
      )}

      {!checkinKnown && heroSkeleton}

      {checkinKnown && !hasCheckin && (
        <CheckinHero
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
        />
      )}

      {hasCheckin && (
        <div className="ux-enter flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3">
          <p className="flex items-center gap-2.5 text-sm text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-gold/60 text-xs text-gold" aria-hidden="true">
              ✓
            </span>
            Check-in du jour enregistré
          </p>
          <SecondaryButton onClick={() => setSheetOpen(true)} className="min-h-10 px-3 py-1.5 text-xs uppercase tracking-[0.12em]">
            Modifier
          </SecondaryButton>
        </div>
      )}

      <Card>
        <SectionHeader title="Après ta séance" subtitle="Ce que tu as vraiment fait aujourd'hui." />
        <div className="mt-4">{athleteId && <CompletedSessionCard date={canonicalDate} athleteId={athleteId} />}</div>
      </Card>

      {!athleteId && <p className="text-sm text-red-400">Erreur de configuration : aucun athlète résolu.</p>}

      <CheckinSheet open={sheetOpen} onClose={closeSheet}>
        {athleteId && (
          <CheckinForm
            athleteId={athleteId}
            date={canonicalDate}
            mode="guided"
            onCheckinAvailabilityChange={handleCheckinAvailability}
            onSaved={handleCheckinSaved}
          />
        )}
      </CheckinSheet>
    </PageShell>
  );
}
