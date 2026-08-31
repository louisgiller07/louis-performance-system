import { NavLink } from "react-router-dom";

// V0.3_003C added a 4th tab (Plan) — px-3/text-sm (sized for 3 tabs) risks
// overflow/clipping at narrow phone widths (~320px). Smaller padding/text
// below sm: (640px), the original comfortable sizing at sm: and above.
const LINK_BASE = "flex min-h-11 flex-1 items-center justify-center rounded px-1.5 text-xs font-medium sm:px-3 sm:text-sm";
const LINK_ACTIVE = "bg-gray-900 text-white";
const LINK_INACTIVE = "text-gray-500 active:bg-gray-100";

// Minimal navigation — no sidebar, no menu. Shared between TodayPage,
// /plan (V0.3_003C), the /history pages (M4_006), and /insights (V0.3_001C-3).
export function AppNav() {
  return (
    <nav className="flex gap-1">
      <NavLink to="/today" className={({ isActive }) => `${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}>
        Aujourd'hui
      </NavLink>
      <NavLink to="/plan" className={({ isActive }) => `${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}>
        Plan
      </NavLink>
      <NavLink to="/history" className={({ isActive }) => `${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}>
        Historique
      </NavLink>
      <NavLink to="/insights" className={({ isActive }) => `${LINK_BASE} ${isActive ? LINK_ACTIVE : LINK_INACTIVE}`}>
        Insights
      </NavLink>
    </nav>
  );
}
