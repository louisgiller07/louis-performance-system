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
            className="ux-press inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink/80 hover:text-gold"
          >
            ← Historique
          </Link>
        </header>
      }
    >
      {state === "loading" && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="sr-only">Chargement…</p>
          <div className="ux-skeleton h-8 w-2/3 rounded" />
          <div className="ux-skeleton h-56 rounded-2xl" />
        </div>
      )}

      {state === "error" && (
        <p role="alert" className="text-sm text-red-400">
          {GENERIC_ERROR_MESSAGE}
        </p>
      )}

      {state === "not_found" && (
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="font-display text-2xl font-extrabold uppercase leading-tight text-ink">Journée introuvable</p>
          <p className="mt-2 text-sm text-ink/80">Elle n'existe plus ou n'est pas accessible depuis ce compte.</p>
        </div>
      )}

      {state === "success" && row && (
        <>
          {/* UX-10A — the day as a title; the time of this decision stays as a detail. */}
          <div>
            <h1 className="font-display text-4xl font-extrabold uppercase leading-none text-ink">{formatCalendarDate(row.decisionDate)}</h1>
            <p className="mt-1 text-sm text-muted">{`Décision de ${formatLocalTime(row.createdAt)}`}</p>
          </div>
          <HistoryDetail row={row} performedMatch={performedMatch} />
        </>
      )}
    </PageShell>
  );
}
