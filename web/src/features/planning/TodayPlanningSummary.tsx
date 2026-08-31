import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatIntervention } from "../dailyPlan/dailyPlanLabels";
import { SESSION_TYPE_LABELS } from "../completedSession/completedSessionTypes";
import { loadPlannedSessions } from "./planningRepo";
import type { PlannedSessionRow } from "./planningTypes";

type LoadState = "loading" | "loaded" | "error";

interface TodayPlanningSummaryProps {
  athleteId: string;
  date: string;
}

// Never falls back to the raw row.session_type value — an internal
// DbSessionType enum must never reach the athlete-facing UI, even for a
// legacy row whose coarse type somehow isn't in SESSION_TYPE_LABELS
// despite the typed contract (defense in depth, not expected in practice).
const UNKNOWN_LEGACY_LABEL = "Séance planifiée (ancienne)";

/**
 * Read-only "Prévu aujourd'hui" section for /today (V0.3_003D). Represents
 * ONLY the current athlete-authored planned_sessions row for today — never
 * the T-X/inference fallback, the race protocol recommendation, or the
 * Head Coach's actual final_session (that stays DailyPlanPanel's own
 * section, further down the page). No create/edit/delete here — only a
 * link to /plan. Fetches once on mount; route remount (locked V0.3_003A)
 * is the only freshness mechanism — daily-run never mutates
 * planned_sessions, so no refetch after a plan is generated.
 */
export function TodayPlanningSummary({ athleteId, date }: TodayPlanningSummaryProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [row, setRow] = useState<PlannedSessionRow | null>(null);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    loadPlannedSessions(athleteId, date, date)
      .then((rows) => {
        if (!active) return;
        setRow(rows[0] ?? null);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [athleteId, date]);

  if (loadState === "loading") {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Prévu aujourd'hui</h2>
        <p className="mt-1 text-sm text-gray-400">Chargement…</p>
      </section>
    );
  }

  // A Planning-read failure is non-critical: check-in, daily-run, and the
  // actual Head Coach decision must never be blocked by it.
  if (loadState === "error") {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Prévu aujourd'hui</h2>
        <p className="mt-1 text-sm text-gray-500">Planning indisponible.</p>
        <Link to="/plan" className="mt-2 inline-block text-xs font-medium text-gray-500 underline">
          Modifier dans Plan
        </Link>
      </section>
    );
  }

  const displayLabel = row
    ? row.intervention
      ? formatIntervention(row.intervention)
      : (SESSION_TYPE_LABELS[row.session_type] ?? UNKNOWN_LEGACY_LABEL)
    : "Non planifié";

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Prévu aujourd'hui</h2>
      <p className={`mt-1 text-sm font-medium ${row ? "text-gray-900" : "text-gray-400"}`}>{displayLabel}</p>
      <Link to="/plan" className="mt-2 inline-block text-xs font-medium text-gray-500 underline">
        Modifier dans Plan
      </Link>
    </section>
  );
}
