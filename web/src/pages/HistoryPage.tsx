import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AppNav } from "../components/AppNav";
import { HistoryList } from "../features/history/HistoryList";
import { loadDecisionHistory, loadCompletedSessionsForDates } from "../features/history/historyRepo";
import type { DecisionHistoryRow } from "../features/history/historyTypes";
import { buildLinkedSessionsByDecisionId } from "../features/history/historyPerformedMatch";
import type { CompletedSessionRecord } from "../features/completedSession/completedSessionTypes";

type LoadState = "loading" | "success" | "error";

// A fixed, generic message — never the caught error's own .message. Today
// historyRepo only ever throws HistoryLoadError (already a safe, generic
// message), but this page doesn't rely on that holding true forever: an
// unexpected exception (a bug, a different error type entirely) must never
// surface a raw PostgREST/DB detail into the UI.
const GENERIC_ERROR_MESSAGE = "Impossible de charger l'historique. Réessaie.";

// M4_006 — read-only decision history. Never calls daily-run, never
// recomputes a plan; loadDecisionHistory only reads decisions.daily_plan
// as persisted, through the caller's own RLS-scoped Supabase client.
export function HistoryPage() {
  const { user, athleteId, signOut } = useAuth();
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<DecisionHistoryRow[]>([]);
  const [linkedSessions, setLinkedSessions] = useState<Map<string, CompletedSessionRecord>>(new Map());

  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    setState("loading");

    loadDecisionHistory(athleteId)
      .then(async (result) => {
        if (!active) return;
        // V0.3_007D — ONE additional batched query for every unique date
        // among the currently-loaded decisions (never per-decision/per-date
        // — no N+1), direct RLS SELECT, never the completed-session Edge
        // Function (single-date only). Failure here is treated the same as
        // a decisions-load failure — no partial/degraded success state.
        const dates = result.map((row) => row.decisionDate);
        const sessions = await loadCompletedSessionsForDates(athleteId, dates);
        if (!active) return;
        setLinkedSessions(buildLinkedSessionsByDecisionId(sessions));
        setRows(result);
        setState("success");
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Name only — never the message, which could echo internals for an
        // error type historyRepo didn't anticipate.
        console.error("HistoryPage: failed to load decision history", error instanceof Error ? error.name : typeof error);
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [athleteId]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
      <header className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-sm font-semibold text-gray-900">Louis Performance System</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-gray-400">{user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 active:bg-gray-100"
            >
              Déconnexion
            </button>
          </div>
        </div>
        <AppNav />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="text-lg font-semibold text-gray-900">Historique</h1>

        {state === "loading" && <p className="text-sm text-gray-500">Chargement…</p>}

        {state === "error" && (
          <p role="alert" className="text-sm text-red-600">
            {GENERIC_ERROR_MESSAGE}
          </p>
        )}

        {state === "success" && rows.length === 0 && <p className="text-sm text-gray-500">Aucune décision enregistrée pour le moment.</p>}

        {state === "success" && rows.length > 0 && <HistoryList rows={rows} linkedSessions={linkedSessions} />}
      </main>
    </div>
  );
}
