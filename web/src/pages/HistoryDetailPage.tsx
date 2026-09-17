import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageShell } from "../components/PageShell";
import { formatCalendarDate, formatLocalTime } from "../lib/date";
import { HistoryDetail } from "../features/history/HistoryDetail";
import { loadDecisionById, loadCompletedSessionsForDates } from "../features/history/historyRepo";
import type { DecisionHistoryRow } from "../features/history/historyTypes";
import { matchPerformedSession, type PerformedMatch } from "../features/history/historyPerformedMatch";

type LoadState = "loading" | "success" | "not_found" | "error";

// A fixed, generic message — never the caught error's own .message. See
// HistoryPage.tsx's GENERIC_ERROR_MESSAGE for why this doesn't rely on
// historyRepo always throwing a pre-sanitized error.
const GENERIC_ERROR_MESSAGE = "Impossible de charger cette décision. Réessaie.";

// Read-only detail for one stored decision — decisionId in the URL is not
// itself a secret; RLS (decisions_own_data) is what actually protects it,
// exactly as for /history's list.
export function HistoryDetailPage() {
  const { decisionId } = useParams<{ decisionId: string }>();
  const { athleteId } = useAuth();
  const [state, setState] = useState<LoadState>("loading");
  const [row, setRow] = useState<DecisionHistoryRow | null>(null);
  const [performedMatch, setPerformedMatch] = useState<PerformedMatch>({ kind: "none" });

  useEffect(() => {
    if (!athleteId || !decisionId) return;
    let active = true;
    setState("loading");

    loadDecisionById(athleteId, decisionId)
      .then(async (result) => {
        if (!active) return;
        if (!result) {
          setState("not_found");
          return;
        }
        // V0.3_007D — a second, RLS-scoped read for the exact same date,
        // never the completed-session Edge Function (single-date only, not
        // meant for a batched/historical read). Failure here is treated the
        // same as a decisions-load failure — no partial/degraded success
        // state, matching the page's existing all-or-nothing convention.
        const sessions = await loadCompletedSessionsForDates(athleteId, [result.decisionDate]);
        if (!active) return;
        setPerformedMatch(matchPerformedSession(result.id, result.decisionDate, sessions));
        setRow(result);
        setState("success");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("HistoryDetailPage: failed to load decision", error instanceof Error ? error.name : typeof error);
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [athleteId, decisionId]);

  return (
    <PageShell
      header={
        <header className="flex items-center gap-3 border-b border-white/5 bg-bg px-2 py-2">
          <Link
            to="/history"
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-muted active:bg-white/5 active:text-ink"
          >
            ← Historique
          </Link>
        </header>
      }
    >
      {state === "loading" && <p className="text-sm text-muted">Chargement…</p>}

      {state === "error" && (
        <p role="alert" className="text-sm text-red-400">
          {GENERIC_ERROR_MESSAGE}
        </p>
      )}

      {state === "not_found" && <p className="text-sm text-muted">Décision introuvable.</p>}

      {state === "success" && row && (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {formatCalendarDate(row.decisionDate)} · {formatLocalTime(row.createdAt)}
          </p>
          <HistoryDetail row={row} performedMatch={performedMatch} />
        </>
      )}
    </PageShell>
  );
}
