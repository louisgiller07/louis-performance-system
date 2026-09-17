import { useAuth } from "../auth/AuthContext";
import { AppNav } from "./AppNav";

// V0.3 UX PREMIUM — Global App Redesign. The standard authenticated header
// (brand mark, email, Déconnexion, AppNav) — identical across
// TodayPage/PlanPage/HistoryPage/InsightsPage before this, now a single
// component. Reads user/signOut from useAuth() itself (already required to
// be inside AuthProvider on every route that renders it) so call sites
// don't need to prop-drill. HistoryDetailPage uses its own distinct
// back-link header instead (a one-off, not a shared nav surface) — not
// built on this component.
export function AppHeader() {
  const { user, signOut } = useAuth();

  return (
    <header className="flex flex-col gap-2 border-b border-white/5 bg-bg px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-sm font-semibold uppercase tracking-widest text-gold">Nalynt</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted">{user?.email}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="shrink-0 rounded border border-white/10 px-3 py-1.5 text-xs font-medium text-ink/80 active:bg-white/5"
          >
            Déconnexion
          </button>
        </div>
      </div>
      <AppNav />
    </header>
  );
}
