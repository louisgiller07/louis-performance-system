import type { ReactNode } from "react";
import { AppNav } from "./AppNav";

interface PageShellProps {
  /** Rendered above <main> — typically <AppHeader/>, or a page-specific header (e.g. HistoryDetailPage's back-link). */
  header: ReactNode;
  children: ReactNode;
}

// V0.3 UX PREMIUM — Global App Redesign. The one shared page container
// every authenticated page renders into. Layout only: no data, no auth, no
// navigation logic lives here.
//
// UX-02 — also renders the fixed bottom tab bar (AppNav) for every
// authenticated page, and reserves room for it (plus the iOS home
// indicator) at the bottom of <main>. The privacy link moved to the Profil
// tab.
export function PageShell({ header, children }: PageShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-bg">
      {header}
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5">{children}</main>
      <AppNav />
    </div>
  );
}
