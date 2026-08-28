import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AppNav } from "../components/AppNav";
import { InsightCard, type InsightCardNotice } from "../features/insights/InsightCard";
import { buildSubmitReviewBody, getInsights, submitReview } from "../features/insights/insightsRepo";
import type { GetInsightsResponse, PatternInsightCandidate, PatternInsightReviewDecision } from "../features/insights/insightsTypes";
import type { InsightsError } from "../features/insights/insightsErrors";

type PageState = { status: "loading" } | { status: "error"; error: InsightsError } | { status: "loaded"; response: GetInsightsResponse };

interface PageNotice {
  readonly id: string;
  readonly message: string;
}

function newNoticeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// V0.3_001C-3 — minimal authenticated Insights surface: loads get-insights
// (never refresh-longitudinal — there is no scheduler/automatic refresh
// caller, and this page never becomes one), renders candidates, and lets
// the athlete submit an explicit human review via submit-review. The
// success response is never trusted as authoritative review state — every
// outcome (success, stale_candidate, candidate_not_found) is followed by a
// fresh get-insights read, and only that fresh server response is rendered.
// accepted_as_insight never triggers any daily-run/coaching action here —
// V0.3_001 locks zero coaching influence.
export function InsightsPage() {
  const { user, signOut } = useAuth();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [submittingKeys, setSubmittingKeys] = useState<ReadonlySet<string>>(new Set());
  const [cardNotices, setCardNotices] = useState<Readonly<Record<string, InsightCardNotice>>>({});
  const [pageNotices, setPageNotices] = useState<readonly PageNotice[]>([]);

  const load = useCallback(async () => {
    const result = await getInsights();
    if (!result.ok) {
      setState({ status: "error", error: result.error });
      // Mirrors CompletedSessionCard's existing convention: a session_issue
      // error is the app's one established signal that the JWT is no
      // longer valid.
      if (result.error.action === "session_issue") void signOut();
      return;
    }
    setState({ status: "loaded", response: result.data });
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  function setSubmitting(key: string, value: boolean) {
    setSubmittingKeys((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function clearCardNotice(key: string) {
    setCardNotices((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function setCardNotice(key: string, notice: InsightCardNotice) {
    setCardNotices((prev) => ({ ...prev, [key]: notice }));
  }

  function dismissPageNotice(id: string) {
    setPageNotices((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleReview(candidate: PatternInsightCandidate, decision: PatternInsightReviewDecision, reviewerNote: string | null) {
    const key = candidate.snapshot.detectorRuleId;
    setSubmitting(key, true);
    clearCardNotice(key);

    const body = buildSubmitReviewBody(candidate.snapshot, decision, reviewerNote);
    const result = await submitReview(body);

    if (result.ok) {
      // Authoritative state comes ONLY from a fresh read — never from
      // {action, reviewNumber} alone (never locally set reviewState here).
      await load();
      setCardNotice(key, { kind: "success", message: "Revue enregistrée." });
      setSubmitting(key, false);
      return;
    }

    if (result.kind === "stale_candidate") {
      // Refetch immediately — the fresh candidate the 409 body carried is
      // never trusted directly, and reviewerNote/decision are never
      // resubmitted automatically. A new explicit human click is required.
      await load();
      setCardNotice(key, { kind: "stale", message: "Cet insight a changé depuis ta dernière visite. Vérifie la nouvelle version puis revote si besoin." });
      setSubmitting(key, false);
      return;
    }

    if (result.kind === "candidate_not_found") {
      await load();
      setPageNotices((prev) => [...prev, { id: newNoticeId(), message: "Cet insight n'est plus disponible." }]);
      setSubmitting(key, false);
      return;
    }

    setCardNotice(key, { kind: "error", message: result.error.message });
    if (result.error.action === "session_issue") void signOut();
    setSubmitting(key, false);
  }

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
              Logout
            </button>
          </div>
        </div>
        <AppNav />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="text-lg font-semibold text-gray-900">Insights</h1>

        {pageNotices.map((notice) => (
          <div key={notice.id} role="status" className="flex items-center justify-between gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
            <span>{notice.message}</span>
            <button type="button" onClick={() => dismissPageNotice(notice.id)} className="shrink-0 text-xs font-medium text-gray-500">
              Fermer
            </button>
          </div>
        ))}

        {state.status === "loading" && <p className="text-sm text-gray-500">Chargement…</p>}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-600">
              {state.error.message}
            </p>
            <button type="button" onClick={() => void load()} className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
              Réessayer
            </button>
          </div>
        )}

        {state.status === "loaded" && state.response.candidates.length === 0 && (
          <p className="text-sm text-gray-500">Aucun insight à examiner pour le moment.</p>
        )}

        {state.status === "loaded" &&
          state.response.candidates.map((candidate) => (
            <InsightCard
              key={candidate.snapshot.detectorRuleId}
              candidate={candidate}
              submitting={submittingKeys.has(candidate.snapshot.detectorRuleId)}
              notice={cardNotices[candidate.snapshot.detectorRuleId] ?? null}
              onReview={(decision, reviewerNote) => void handleReview(candidate, decision, reviewerNote)}
            />
          ))}
      </main>
    </div>
  );
}
