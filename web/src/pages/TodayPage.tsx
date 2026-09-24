import { useEffect, useMemo, useState } from "react";
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
    return FRIENDLY_DATE_FORMAT.format(new Date(year, month - 1, day));
  }, [canonicalDate]);

  return (
    <PageShell header={<AppHeader />}>
      <Card className="px-5 py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Today</p>
        <p className="mt-2 text-2xl font-bold uppercase tracking-tight text-ink">{friendlyDate}</p>
        <p className="mt-1 font-mono text-xs text-muted">{canonicalDate}</p>
      </Card>

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

      {/*
       * V0.3 UX PREMIUM REDESIGN — hierarchy: Mission du jour -> Head
       * Coach Decision -> Readiness -> Session Plan, all rendered inside
       * DailyPlanPanel/DailyPlanResult/DailyPlanView (missionSlot/
       * readinessSlot). No redundant section header here — DecisionHero
       * already carries its own "Head Coach Decision" label; a generic
       * "Plan du jour" label above it would only compete with it.
       */}
      <Card>
        {athleteId && (
          <DailyPlanPanel athleteId={athleteId} date={canonicalDate} hasCheckin={hasCheckin} checkinRevision={checkinRevision} />
        )}
      </Card>

      <Card>
        <SectionHeader title="Check-in" subtitle="Ton rituel quotidien avant de rouler." />
        <div className="mt-4">
          {athleteId ? (
            <CheckinForm
              athleteId={athleteId}
              date={canonicalDate}
              onCheckinAvailabilityChange={setHasCheckin}
              onSaved={() => setCheckinRevision((revision) => revision + 1)}
            />
          ) : (
            <p className="text-sm text-red-400">Erreur de configuration : aucun athlète résolu.</p>
          )}
        </div>
      </Card>

      {athleteId && <TodayPlanningSummary athleteId={athleteId} date={canonicalDate} />}

      <Card>
        <SectionHeader title="Séance du jour" />
        <div className="mt-4">{athleteId && <CompletedSessionCard date={canonicalDate} athleteId={athleteId} />}</div>
      </Card>
    </PageShell>
  );
}
