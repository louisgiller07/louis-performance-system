import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { todayLocal } from "../lib/date";
import { CheckinForm } from "../features/checkin/CheckinForm";
import { DailyPlanPanel } from "../features/dailyPlan/DailyPlanPanel";
import { AppNav } from "../components/AppNav";

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
          <span className="text-sm font-semibold text-gray-900">Louis Performance System</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-gray-400">{user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 active:bg-gray-100"
            >
              Logout
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

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Daily Check-in</h2>
          <p className="mb-4 mt-1 text-sm text-gray-500">Ton état du jour</p>
          {athleteId ? (
            <CheckinForm
              athleteId={athleteId}
              date={canonicalDate}
              onCheckinAvailabilityChange={setHasCheckin}
              onSaved={() => setCheckinRevision((revision) => revision + 1)}
            />
          ) : (
            <p className="text-sm text-red-600">Configuration error: no athlete resolved.</p>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Daily Plan</h2>
          <p className="mb-4 mt-1 text-sm text-gray-500">Généré à partir de ton check-in du jour</p>
          {athleteId && <DailyPlanPanel date={canonicalDate} hasCheckin={hasCheckin} checkinRevision={checkinRevision} />}
        </section>
      </main>
    </div>
  );
}
