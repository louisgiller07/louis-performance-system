import { Link, useLocation } from "react-router-dom";

// UX-02 — bottom tab bar (thumb zone), four destinations only. Replaces the
// previous 5-pill top nav. Each tab also owns the routes that live under it,
// so it stays highlighted while you drill down:
// - Aujourd'hui: /today
// - Programme: /training-plan, /training-plan-preview/*, /plan (manual week
//   planning, reached from Programme — the former "Semaine" tab)
// - Historique: /history, /history/:decisionId, /insights (reached from
//   Historique — the former "Insights" tab)
// - Profil: /profile, /performance-setup (athlete configuration)
// Minimal inline line icons (currentColor), no icon library.
type TabIcon = "today" | "programme" | "history" | "profile";

interface Tab {
  to: string;
  label: string;
  icon: TabIcon;
  prefixes: string[];
}

const TABS: Tab[] = [
  { to: "/today", label: "Aujourd'hui", icon: "today", prefixes: ["/today"] },
  { to: "/training-plan", label: "Programme", icon: "programme", prefixes: ["/training-plan", "/plan"] },
  { to: "/history", label: "Historique", icon: "history", prefixes: ["/history", "/insights"] },
  { to: "/profile", label: "Profil", icon: "profile", prefixes: ["/profile", "/performance-setup"] },
];

const ICON_PATHS: Record<TabIcon, string> = {
  today: "M12 3v2.5M12 18.5V21M4.2 12H3m18 0h-1.2M6.3 6.3 5.2 5.2m13.6 13.6-1.1-1.1m0-11.4 1.1-1.1M5.2 18.8l1.1-1.1M12 8a4 4 0 100 8 4 4 0 000-8z",
  programme: "M4 6.5h16M4 6.5V19h16V6.5M8 3.5v3M16 3.5v3M7.5 11h3M7.5 14.5h3M13.5 11h3",
  history: "M4 12a8 8 0 102.3-5.6M4 4v4h4M12 8v4l3 2",
  profile: "M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0",
};

function isTabActive(tab: Tab, pathname: string): boolean {
  return tab.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}-`));
}

export function AppNav() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-line bg-bg/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="flex">
        {TABS.map((tab) => {
          const active = isTabActive(tab, pathname);
          return (
            <li key={tab.to} className="min-w-0 flex-1">
              <Link
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={`ux-press relative flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] min-[400px]:text-xs min-[400px]:tracking-widest ${
                  active ? "text-gold" : "text-muted hover:text-ink"
                }`}
              >
                <span
                  className={`absolute left-1/2 top-0 h-px w-10 -translate-x-1/2 bg-gold transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0"}`}
                  aria-hidden="true"
                />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                  <path d={ICON_PATHS[tab.icon]} />
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
