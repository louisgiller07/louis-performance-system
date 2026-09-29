import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// UX-02 — the slim authenticated top bar: brand mark on the left, one
// optional page-specific element on the right (e.g. Today's short date).
// E-mail, Configuration and Déconnexion no longer live here — they moved to
// the Profil tab (src/pages/ProfilePage.tsx). Navigation is the bottom tab
// bar (AppNav), rendered by PageShell.
export function AppHeader({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <Link to="/today" className="font-display text-lg font-extrabold uppercase tracking-[0.28em] text-ink">
        Nalynt
      </Link>
      {trailing && <div className="min-w-0 truncate text-right text-sm text-muted">{trailing}</div>}
    </header>
  );
}
