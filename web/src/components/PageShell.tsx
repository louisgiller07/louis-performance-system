import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface PageShellProps {
  /** Rendered above <main> — typically <AppHeader/>, or a page-specific header (e.g. HistoryDetailPage's back-link). */
  header: ReactNode;
  children: ReactNode;
}

// V0.3 UX PREMIUM — Global App Redesign. The one shared page container
// (background, max width, min height, main padding/gap) every authenticated
// page renders into — replaces five near-identical hand-rolled copies
// (TodayPage/PlanPage/HistoryPage/HistoryDetailPage/InsightsPage). Layout
// only: no data, no auth, no navigation logic lives here.
export function PageShell({ header, children }: PageShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-bg">
      {header}
      <main className="flex flex-1 flex-col gap-4 px-4 py-6">{children}</main>
      <footer className="px-4 pb-6 text-center">
        <Link to="/privacy" className="text-xs text-muted underline">
          Confidentialité
        </Link>
      </footer>
    </div>
  );
}
