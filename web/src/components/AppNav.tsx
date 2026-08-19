import { NavLink } from "react-router-dom";

const LINK_BASE = "rounded px-3 py-1.5 text-xs font-medium";
const LINK_ACTIVE = "bg-gray-900 text-white";
const LINK_INACTIVE = "text-gray-500 active:bg-gray-100";

// Minimal two-tab navigation — no sidebar, no menu. Shared between
// TodayPage and the /history pages (M4_006).
export function AppNav() {
  return (
    <nav className="flex gap-1">
      <NavLink to="/today" className={({ isActive }) => `${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}>
        Aujourd'hui
      </NavLink>
      <NavLink to="/history" className={({ isActive }) => `${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}>
        Historique
      </NavLink>
    </nav>
  );
}
