import { StateCard } from "../components/StateCard";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";
import { SubPageLink } from "../components/SubPageLink";
import { AppHeader } from "../components/AppHeader";
import { useEffectiveToday } from "../lib/simulationClock";
import { raceHorizon } from "../features/today/todayContext";
import { loadHistoryJourney, type HistoryJourney } from "../features/history/historyJourneyRepo";
import { journeyFacts } from "../features/history/historyDays";
import { HistoryJourneyHero } from "../features/history/HistoryJourneyHero";
import { HistoryTimeline } from "../features/history/HistoryTimeline";
import { HistoryJourneySummary } from "../features/history/HistoryJourneySummary";

type LoadState = { status: "loading" } | { status: "error" } | { status: "success"; journey: HistoryJourney };

// A fixed, generic message — never the caught error's own .message: an
// unexpected exception must never surface a raw PostgREST/DB detail.
const GENERIC_ERROR_MESSAGE = "Impossible de charger l'historique. Réessaie.";

// M4_006 / UX-07 — the rider's journey, read-only. Never calls daily-run,
// never recomputes a plan: decisions.daily_plan as persisted, grouped into
// days (historyDays.ts), through the caller's own RLS-scoped client.
export function HistoryPage() {
  const { athleteId } = useAuth();
  // Same canonical "today" as Today and Programme.
  const today = useEffectiveToday();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    setState({ status: "loading" });
    loadHistoryJourney(athleteId, today)
      .then((journey) => {
        if (active) setState({ status: "success", journey });
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Name only — never the message.
        console.error("HistoryPage: failed to load decision history", error instanceof Error ? error.name : typeof error);
        setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [athleteId, today]);

  const journey = state.status === "success" ? state.journey : null;
  const horizon = useMemo(() => (journey ? raceHorizon(journey.races, today) : null), [journey, today]);
  const facts = journey ? journeyFacts(journey.days, today) : null;

  return (
    <PageShell header={<AppHeader />}>
      <HistoryJourneyHero horizon={horizon} objective={journey?.objective ?? null} />

      {state.status === "loading" && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="sr-only">Chargement…</p>
          <div className="ux-skeleton h-56 rounded-2xl" />
          <div className="ux-skeleton h-40 rounded-2xl" />
        </div>
      )}

      {state.status === "error" && (
        <StateCard tone="error" title="Historique indisponible">
          {GENERIC_ERROR_MESSAGE}
        </StateCard>
      )}

      {journey && journey.days.length === 0 && (
        <div className="rounded-xl border border-line bg-card p-5">
          <p className="text-sm text-ink/80">Ton parcours commence avec ton premier check-in.</p>
          <Link to="/today" className="ux-press mt-2 inline-flex min-h-11 items-center text-sm text-gold underline-offset-4 hover:underline">
            Faire mon check-in →
          </Link>
        </div>
      )}

      {journey && journey.days.length > 0 && <HistoryTimeline days={journey.days} today={today} />}
      {facts && <HistoryJourneySummary facts={facts} />}

      <SubPageLink to="/insights" label="Ce que NALYNT remarque" hint="· tendances observées" />
    </PageShell>
  );
}
