import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { formatCalendarDate, formatLocalTime } from "../lib/date";
import { HistoryDetail } from "../features/history/HistoryDetail";
import { loadDecisionById } from "../features/history/historyRepo";
import type { DecisionHistoryRow } from "../features/history/historyTypes";

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

  useEffect(() => {
    if (!athleteId || !decisionId) return;
    let active = true;
    setState("loading");

    loadDecisionById(athleteId, decisionId)
      .then((result) => {
        if (!active) return;
        if (!result) {
          setState("not_found");
          return;
        }
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
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50">
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <Link to="/history" className="text-sm font-medium text-gray-500 active:text-gray-900">
          ← Historique
        </Link>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        {state === "loading" && <p className="text-sm text-gray-500">Chargement…</p>}

        {state === "error" && (
          <p role="alert" className="text-sm text-red-600">
            {GENERIC_ERROR_MESSAGE}
          </p>
        )}

        {state === "not_found" && <p className="text-sm text-gray-500">Décision introuvable.</p>}

        {state === "success" && row && (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {formatCalendarDate(row.decisionDate)} · {formatLocalTime(row.createdAt)}
            </p>
            <HistoryDetail row={row} />
          </>
        )}
      </main>
    </div>
  );
}
