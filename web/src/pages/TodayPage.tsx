import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import { todayLocal } from "../lib/date";

const FRIENDLY_DATE_FORMAT = new Intl.DateTimeFormat("fr-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

// M4_002 — real skeleton, no check-in logic yet (M4_003). Athlete
// resolution already happened in RequireAuth/AuthContext; this page never
// re-resolves it.
export function TodayPage() {
  const { user, signOut } = useAuth();

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
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
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
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Aujourd'hui</p>
          <p className="mt-1 text-lg font-semibold capitalize text-gray-900">{friendlyDate}</p>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{canonicalDate}</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Daily Check-in</h2>
          <p className="mt-1 text-sm text-gray-500">Ton état du jour</p>
          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">
            Formulaire disponible dans M4_003
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Daily Plan</h2>
          <p className="mt-1 text-sm text-gray-500">Aucun plan généré</p>
          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">
            Disponible après check-in
          </p>
        </section>
      </main>
    </div>
  );
}
