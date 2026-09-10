import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { todayLocal } from "../lib/date";
import { CheckinForm } from "../features/checkin/CheckinForm";
import { TodayPlanningSummary } from "../features/planning/TodayPlanningSummary";
import { DailyPlanPanel } from "../features/dailyPlan/DailyPlanPanel";
import { CompletedSessionCard } from "../features/completedSession/CompletedSessionCard";
import { AppNav } from "../components/AppNav";
import { HealthFlagBanner } from "../features/healthFlags/HealthFlagBanner";
import { loadOpenHealthFlags, type OpenHealthFlag } from "../features/healthFlags/openHealthFlagsRepo";

const FRIENDLY_DATE_FORMAT = new Intl.DateTimeFormat("fr-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

// M4_002 — real skeleton, no check-in logic yet (M4_003). Athlete
// resolution already happened in RequireAuth/AuthContext; this page never
// re-resolves it.
export function TodayPage() {
  const { user, athleteId, signOut } = useAuth();
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

  // Canonical YYYY-MM-DD in the user's own local timezone (see
  // src/lib/date.ts) — kept for the future check-in/daily-run calls, not
  // just display.
  const canonicalDate = useMemo(() => todayLocal(), []);

  const friendlyDate = useMemo(() => {
    // Parse the canonical date as a local calendar date (year, month, day
    // components), not via `new Date(canonicalDate)` — that constructor
    // treats a bare YYYY-MM-DD string as UTC midnight, which can render the
    // wrong weekday/day near a timezone boundary.
    const [year, month, day] = canonicalDate.split("-").map(Number);
    return FRIENDLY_DATE_FORMAT.format(new Date(year, month - 1, day));
  }, [canonicalDate]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
      <header className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-sm font-semibold text-gray-900">Louis Performance System</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-gray-400">{user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 active:bg-gray-100"
            >
              Déconnexion
            </button>
          </div>
        </div>
        <AppNav />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Aujourd'hui</p>
          <p className="mt-1 text-lg font-semibold capitalize text-gray-900">{friendlyDate}</p>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{canonicalDate}</p>
        </section>

        <HealthFlagBanner flags={openHealthFlags} />

        {athleteId && <TodayPlanningSummary athleteId={athleteId} date={canonicalDate} />}

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Check-in du jour</h2>
          <p className="mb-4 mt-1 text-sm text-gray-500">Ton état du jour</p>
          {athleteId ? (
            <CheckinForm
              athleteId={athleteId}
              date={canonicalDate}
              onCheckinAvailabilityChange={setHasCheckin}
              onSaved={() => setCheckinRevision((revision) => revision + 1)}
            />
          ) : (
            <p className="text-sm text-red-600">Erreur de configuration : aucun athlète résolu.</p>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Plan du jour</h2>
          <p className="mb-4 mt-1 text-sm text-gray-500">Généré à partir de ton check-in du jour</p>
          {athleteId && (
            <DailyPlanPanel athleteId={athleteId} date={canonicalDate} hasCheckin={hasCheckin} checkinRevision={checkinRevision} />
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Séance du jour</h2>
          {athleteId && <CompletedSessionCard date={canonicalDate} athleteId={athleteId} />}
        </section>
      </main>
    </div>
  );
}
